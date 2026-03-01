import { utilityProcess, BrowserWindow } from 'electron'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { store } from './storage'
import { resolveHookPath } from './hook-storage'
import type {
  ProfileHook,
  HookContext,
  HookResult,
  HookDisplayValue,
  HookActions
} from '../shared/types'

const DEFAULT_TIMEOUT = 30_000
const KILL_GRACE_PERIOD = 5_000
const SWITCH_COOLDOWN = 30_000
const MAX_ENV_SIZE = 128 * 1024 // 128KB

let lastSwitchActionTime = 0
let isSwitching = false

/** Callback for auto-switch actions. Set via setAutoSwitchHandler() to avoid circular imports. */
let autoSwitchHandler:
  | ((request: { type: 'switchToProfile' | 'switchToNextProfile'; profileId?: string; triggeredBy: string }) => void)
  | null = null

/**
 * Register the handler that performs auto-switch from hook actions.
 * Called by switch-orchestrator at init time to avoid circular imports
 * (hook-executor → switch-orchestrator → hook-executor).
 */
export function setAutoSwitchHandler(
  handler: NonNullable<typeof autoSwitchHandler>
): void {
  autoSwitchHandler = handler
}

/** Set by orchestrator to prevent re-entrant switches. */
export function setIsSwitching(value: boolean): void {
  isSwitching = value
}

/**
 * Execute a single hook script using Electron's utilityProcess.fork().
 * Best-effort: failures never throw, only produce a result.
 */
export async function executeHook(hook: ProfileHook, context: HookContext): Promise<HookResult> {
  // Resolve relative/builtin paths to absolute
  const resolvedPath = resolveHookPath(hook.scriptPath)

  // Script validation
  if (!fs.existsSync(resolvedPath)) {
    return {
      hookId: hook.id,
      hookLabel: hook.label,
      success: false,
      error: `Script not found: ${hook.scriptPath} (resolved: ${resolvedPath})`
    }
  }

  const timeout = hook.timeout ?? DEFAULT_TIMEOUT

  // Prepare context JSON: strip file-replace content to reduce size
  const strippedContext: HookContext = {
    ...context,
    profile: {
      ...context.profile,
      items: context.profile.items.map((item) =>
        item.type === 'file-replace' ? { ...item, content: '<stripped>' } : item
      )
    }
  }
  const contextJson = JSON.stringify(strippedContext)

  // If context exceeds 128KB, write to temp file instead of env var
  let contextTempFile: string | undefined
  const hookEnv: Record<string, string> = { ...process.env } as Record<string, string>
  if (Buffer.byteLength(contextJson, 'utf-8') > MAX_ENV_SIZE) {
    contextTempFile = path.join(os.tmpdir(), `xoay-hook-context-${Date.now()}-${hook.id}.json`)
    fs.writeFileSync(contextTempFile, contextJson, 'utf-8')
    hookEnv.XOAY_HOOK_CONTEXT_FILE = contextTempFile
  } else {
    hookEnv.XOAY_HOOK_CONTEXT = contextJson
  }

  return new Promise<HookResult>((resolve) => {
    let stdoutChunks: Buffer[] = []
    let stderrChunks: Buffer[] = []
    let resolved = false
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    let killTimeoutId: ReturnType<typeof setTimeout> | undefined

    const finish = (result: HookResult): void => {
      if (resolved) return
      resolved = true
      if (timeoutId) clearTimeout(timeoutId)
      if (killTimeoutId) clearTimeout(killTimeoutId)
      // Clean up temp context file if used
      if (contextTempFile) {
        try { fs.unlinkSync(contextTempFile) } catch { /* ignore */ }
      }
      resolve(result)
    }

    let child: Electron.UtilityProcess
    try {
      child = utilityProcess.fork(resolvedPath, [], {
        env: hookEnv,
        stdio: 'pipe',
        serviceName: `hook:${hook.label}`
      })
    } catch (err) {
      finish({
        hookId: hook.id,
        hookLabel: hook.label,
        success: false,
        error: `Failed to spawn process: ${err instanceof Error ? err.message : String(err)}`
      })
      return
    }

    // Capture stdout
    if (child.stdout) {
      child.stdout.on('data', (data: Buffer) => {
        stdoutChunks.push(data)
      })
    }

    // Capture stderr
    if (child.stderr) {
      child.stderr.on('data', (data: Buffer) => {
        stderrChunks.push(data)
      })
    }

    // Timeout handling: SIGTERM → wait 5s → SIGKILL
    timeoutId = setTimeout(() => {
      if (resolved) return
      child.kill()
      killTimeoutId = setTimeout(() => {
        if (resolved) return
        // Force kill if still alive — kill() again acts as force
        child.kill()
        finish({
          hookId: hook.id,
          hookLabel: hook.label,
          success: false,
          error: `Hook timed out after ${timeout}ms (force killed)`,
          stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
          stderr: Buffer.concat(stderrChunks).toString('utf-8')
        })
      }, KILL_GRACE_PERIOD)
    }, timeout)

    // Process exit
    child.on('exit', (code: number) => {
      const stdout = Buffer.concat(stdoutChunks).toString('utf-8')
      const stderr = Buffer.concat(stderrChunks).toString('utf-8')
      const success = code === 0

      let display: Record<string, HookDisplayValue> | undefined
      let actions: HookActions | undefined

      // Attempt to parse stdout as JSON for display/actions
      if (stdout.trim()) {
        try {
          const parsed = JSON.parse(stdout.trim())
          if (parsed && typeof parsed === 'object') {
            if (parsed.display) display = parsed.display
            if (parsed.actions) actions = parsed.actions
          }
        } catch {
          // Not valid JSON — ignore, stdout is still captured as raw text
        }
      }

      finish({
        hookId: hook.id,
        hookLabel: hook.label,
        success,
        error: success ? undefined : `Process exited with code ${code}`,
        stdout,
        stderr,
        display,
        actions
      })
    })
  })
}

/**
 * Merge display data from hook results into AppState.hookDisplayData[profileId].
 * Merge semantics: only fields present in output are updated; missing fields are NOT cleared;
 * fields with null value are explicitly cleared.
 */
export function mergeDisplayData(
  profileId: string,
  display: Record<string, HookDisplayValue>
): void {
  const allDisplayData =
    (store.get('hookDisplayData') as Record<string, Record<string, HookDisplayValue>>) ?? {}
  const existing = allDisplayData[profileId] ?? {}

  for (const [key, value] of Object.entries(display)) {
    if (value === null || value.value === null) {
      delete existing[key]
    } else {
      existing[key] = value
    }
  }

  allDisplayData[profileId] = existing
  store.set('hookDisplayData', allDisplayData)
}

/**
 * Process actions from hook results.
 * - Only processes actions from successful hooks
 * - Switch actions only allowed from 'cron' and 'post-switch-in' hooks
 * - Switch actions have 30s cooldown
 * - notify action emits to renderer via IPC
 */
export function processHookActions(
  result: HookResult,
  hookType: ProfileHook['type']
): void {
  if (!result.success || !result.actions) return

  const actions = result.actions

  // Switch actions: only from cron and post-switch-in hooks.
  // post-switch-in is allowed because it runs after a switch completes — e.g. a quota-check
  // hook detects the new profile's API quota is exhausted and triggers rotation to the next profile.
  const switchAllowed = hookType === 'cron' || hookType === 'post-switch-in'

  if (switchAllowed && (actions.switchToNextProfile || actions.switchToProfile)) {
    if (isSwitching) {
      console.log(
        `[hook-executor] Switch action from hook "${result.hookLabel}" ignored — switch already in progress`
      )
    } else if (Date.now() - lastSwitchActionTime < SWITCH_COOLDOWN) {
      console.log(
        `[hook-executor] Switch action from hook "${result.hookLabel}" ignored — cooldown active (${SWITCH_COOLDOWN}ms)`
      )
    } else if (!autoSwitchHandler) {
      console.error(
        `[hook-executor] Switch action from hook "${result.hookLabel}" ignored — no auto-switch handler registered`
      )
    } else {
      lastSwitchActionTime = Date.now()
      if (actions.switchToProfile) {
        console.log(
          `[hook-executor] Auto-switch to profile "${actions.switchToProfile}" triggered by hook "${result.hookLabel}"`
        )
        autoSwitchHandler({
          type: 'switchToProfile',
          profileId: actions.switchToProfile,
          triggeredBy: result.hookLabel
        })
      } else if (actions.switchToNextProfile) {
        console.log(
          `[hook-executor] Auto-switch to next profile triggered by hook "${result.hookLabel}"`
        )
        autoSwitchHandler({
          type: 'switchToNextProfile',
          triggeredBy: result.hookLabel
        })
      }
    }
  } else if (!switchAllowed && (actions.switchToNextProfile || actions.switchToProfile)) {
    console.log(
      `[hook-executor] Switch action from hook "${result.hookLabel}" ignored — not allowed from "${hookType}" hooks`
    )
  }

  // Notify action: emit to renderer
  if (actions.notify) {
    sendToRenderer('hook:notify', {
      message: actions.notify,
      hookLabel: result.hookLabel
    })
  }
}

/**
 * Send a message to all renderer windows via IPC.
 */
function sendToRenderer(channel: string, data: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, data)
  }
}
