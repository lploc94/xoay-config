// hook-runner.js — persistent child process that executes hook scripts inline
// Receives IPC messages from the main process, runs hooks via require(),
// captures stdout/stderr, and sends results back.
//
// Spawned via child_process.fork() from the main process.

'use strict'

const HEARTBEAT_TIMEOUT = 10_000

// ─── Heartbeat ───

let lastHeartbeat = Date.now()

const heartbeatCheck = setInterval(() => {
  if (Date.now() - lastHeartbeat > HEARTBEAT_TIMEOUT) {
    process.exit(0)
  }
}, 5_000)
heartbeatCheck.unref()

process.on('disconnect', () => {
  process.exit(0)
})

// ─── Special error for process.exit() interception ───

class HookExitError extends Error {
  constructor(code) {
    super(`Hook called process.exit(${code})`)
    this.name = 'HookExitError'
    this.exitCode = code ?? 0
  }
}

// ─── Execution queue (single-flight) ───
// Hooks mutate shared globals (process.env, stdout/stderr, process.exit).
// We must serialize execution so only one hook runs at a time.

let busy = false
const queue = []

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function enqueueRun(msg) {
  return new Promise((resolve) => {
    queue.push({ msg, resolve })
    drainQueue()
  })
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function drainQueue() {
  if (busy || queue.length === 0) return
  busy = true
  const { msg, resolve } = queue.shift()
  runHook(msg)
    .catch((err) => {
      // Unexpected error in runner itself — report it
      process.send({
        type: 'result',
        id: msg.id,
        stdout: '',
        stderr: '',
        exitCode: 1,
        error: `Runner error: ${err.message || String(err)}`
      })
    })
    .finally(() => {
      busy = false
      resolve()
      drainQueue()
    })
}

// ─── Hook execution ───

const originalExit = process.exit

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
async function runHook(msg) {
  const { id, scriptPath, env } = msg

  // Save original env and stdout/stderr writers
  const savedEnv = { ...process.env }
  const origStdoutWrite = process.stdout.write
  const origStderrWrite = process.stderr.write

  // Apply env vars
  if (env) {
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined || v === null) {
        delete process.env[k]
      } else {
        process.env[k] = v
      }
    }
  }

  // Capture stdout/stderr
  const stdoutChunks = []
  const stderrChunks = []
  let lastStdoutTime = Date.now()

  process.stdout.write = function (chunk, encoding, callback) {
    lastStdoutTime = Date.now()
    if (typeof chunk === 'string') {
      stdoutChunks.push(chunk)
    } else if (Buffer.isBuffer(chunk)) {
      stdoutChunks.push(chunk.toString('utf-8'))
    }
    // Handle callback
    if (typeof encoding === 'function') {
      encoding()
    } else if (typeof callback === 'function') {
      callback()
    }
    return true
  }

  process.stderr.write = function (chunk, encoding, callback) {
    if (typeof chunk === 'string') {
      stderrChunks.push(chunk)
    } else if (Buffer.isBuffer(chunk)) {
      stderrChunks.push(chunk.toString('utf-8'))
    }
    if (typeof encoding === 'function') {
      encoding()
    } else if (typeof callback === 'function') {
      callback()
    }
    return true
  }

  // Intercept process.exit()
  process.exit = (code) => {
    throw new HookExitError(code)
  }

  let exitCode = 0
  let error
  let listenerSnapshot = {}

  try {
    // Clear require cache so script re-reads on each execution
    const resolved = require.resolve(scriptPath)
    delete require.cache[resolved]

    // Record baseline active handles before executing the script.
    // Async hooks (e.g. codex-quota.js) create TCP socket handles via https.request()
    // that exist until the response completes. We detect async completion by polling
    // until handles return to baseline.
    const baselineHandles = process._getActiveHandles().length

    // Snapshot process listeners before hook execution.
    // After the hook, we remove only listeners the hook added — never removeAllListeners()
    // which would break IPC.
    listenerSnapshot = {}
    for (const event of process.eventNames()) {
      listenerSnapshot[event] = process.listeners(event).slice()
    }

    // Execute the script — this triggers top-level code including main() calls
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const result = require(scriptPath)

    // If the script exports a function, call it
    if (typeof result === 'function') {
      const ret = result()
      if (ret && typeof ret.then === 'function') {
        await ret
      }
    }
    // If require() returned a promise (e.g. top-level async), await it
    else if (result && typeof result.then === 'function') {
      await result
    }

    // Wait for async work to complete using active handles detection.
    // Self-invoking async main() (codex-quota.js) starts network calls that
    // create handles above baseline. We poll until handles settle back down.
    await waitForAsyncCompletion(baselineHandles, () => lastStdoutTime)
  } catch (err) {
    if (err instanceof HookExitError) {
      exitCode = err.exitCode
    } else {
      exitCode = 1
      error = err.message || String(err)
    }
  } finally {
    // Restore stdout/stderr
    process.stdout.write = origStdoutWrite
    process.stderr.write = origStderrWrite

    // Restore process.exit
    process.exit = originalExit

    // Restore env — remove any added keys, restore originals
    for (const key of Object.keys(process.env)) {
      if (!(key in savedEnv)) {
        delete process.env[key]
      }
    }
    for (const [key, val] of Object.entries(savedEnv)) {
      process.env[key] = val
    }

    // Clear require cache for the script (state hygiene)
    try {
      const resolved = require.resolve(scriptPath)
      delete require.cache[resolved]
    } catch {
      // ignore
    }

    // Remove only listeners the hook added (targeted cleanup).
    // Never removeAllListeners() — that would break IPC.
    for (const event of process.eventNames()) {
      const before = listenerSnapshot[event] || []
      const current = process.listeners(event)
      for (const listener of current) {
        if (!before.includes(listener)) {
          process.removeListener(event, listener)
        }
      }
    }
  }

  const result = {
    type: 'result',
    id,
    stdout: stdoutChunks.join(''),
    stderr: stderrChunks.join(''),
    exitCode
  }
  if (error) result.error = error

  process.send(result)
}

/**
 * Wait for async work to complete using active handles detection.
 *
 * Async hooks (e.g. codex-quota.js) use https.request() which creates TCP socket
 * handles. We detect completion by polling process._getActiveHandles() and waiting
 * for the count to return to the baseline recorded before require().
 *
 * For sync scripts (e.g. sync-config.js), handles are already at baseline after
 * require() returns → resolves on the first poll (near-instant).
 *
 * Also checks that no new stdout writes have occurred for 100ms, to ensure
 * final console.log calls have flushed.
 *
 * After both conditions are met, adds a 100ms grace period before resolving.
 *
 * Max wait of 30s prevents hanging forever (main process will also kill us on timeout).
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function waitForAsyncCompletion(baselineHandles, getLastStdoutTime) {
  return new Promise((resolve) => {
    const maxTimeout = setTimeout(resolve, 30_000)

    const poll = setInterval(() => {
      const currentHandles = process._getActiveHandles().length
      const stdoutIdle = Date.now() - getLastStdoutTime() > 100

      if (currentHandles <= baselineHandles && stdoutIdle) {
        clearInterval(poll)
        clearTimeout(maxTimeout)
        // Grace period for final console.log
        setTimeout(resolve, 100)
      }
    }, 50)
    poll.unref()
    maxTimeout.unref()
  })
}

// ─── IPC message handler ───

process.on('message', (msg) => {
  if (!msg || typeof msg !== 'object') return

  if (msg.type === 'heartbeat') {
    lastHeartbeat = Date.now()
    process.send({ type: 'heartbeat-ack' })
    return
  }

  if (msg.type === 'run') {
    lastHeartbeat = Date.now()
    enqueueRun(msg)
    return
  }
})

// Signal to parent that the runner is ready
process.send({ type: 'ready' })
