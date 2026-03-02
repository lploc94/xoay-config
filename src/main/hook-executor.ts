import { app, BrowserWindow, Notification } from 'electron'
import { fork, type ChildProcess } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { store, getProfile, getHookDisplayData } from './storage'
import { resolveHookPath } from './hook-storage'
import { buildTrayMenu } from './tray'
import type {
  ProfileHook,
  HookContext,
  HookResult,
  HookDisplayValue,
  HookActions,
  DisplayItem,
  ConfigUpdate
} from '../shared/types'

const DEFAULT_TIMEOUT = 30_000
const SWITCH_COOLDOWN = 30_000
const MAX_ENV_SIZE = 128 * 1024 // 128KB
const HEARTBEAT_INTERVAL = 5_000

// ─── Runner state ───

let runner: ChildProcess | null = null
let heartbeatTimer: ReturnType<typeof setInterval> | null = null

interface PendingRequest {
  resolve: (result: HookResult) => void
  hookId: string
  hookLabel: string
  timeoutId: ReturnType<typeof setTimeout>
  contextTempFile?: string
}

const pendingRequests = new Map<string, PendingRequest>()

let lastSwitchActionTime = 0
let isSwitching = false

/** Callback for auto-switch actions. Set via setAutoSwitchHandler() to avoid circular imports. */
let autoSwitchHandler:
  | ((request: {
      type: 'switchToProfile' | 'switchToNextProfile'
      profileId?: string
      triggeringProfileId?: string
      triggeredBy: string
    }) => void)
  | null = null

/**
 * Register the handler that performs auto-switch from hook actions.
 * Called by switch-orchestrator at init time to avoid circular imports
 * (hook-executor → switch-orchestrator → hook-executor).
 */
export function setAutoSwitchHandler(handler: NonNullable<typeof autoSwitchHandler>): void {
  autoSwitchHandler = handler
}

/** Set by orchestrator to prevent re-entrant switches. */
export function setIsSwitching(value: boolean): void {
  isSwitching = value
}

// ─── Runner lifecycle ───

/**
 * Resolve the path to hook-runner.js.
 * In dev: resources/hooks/hook-runner.js relative to project root.
 * In production: process.resourcesPath/resources/hooks/hook-runner.js.
 */
function getRunnerScriptPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'resources', 'hooks', 'hook-runner.js')
  }
  return path.join(__dirname, '../../resources/hooks/hook-runner.js')
}

function spawnRunner(): void {
  const scriptPath = getRunnerScriptPath()
  runner = fork(scriptPath, [], { stdio: 'pipe' })

  runner.on('message', (msg: unknown) => {
    if (!msg || typeof msg !== 'object') return
    const m = msg as Record<string, unknown>

    if (m.type === 'ready') {
      return
    }

    if (m.type === 'heartbeat-ack') {
      return
    }

    if (m.type === 'result') {
      const id = m.id as string
      const pending = pendingRequests.get(id)
      if (!pending) return
      pendingRequests.delete(id)
      clearTimeout(pending.timeoutId)

      // Clean up temp context file if used
      if (pending.contextTempFile) {
        try {
          fs.unlinkSync(pending.contextTempFile)
        } catch {
          /* ignore */
        }
      }

      const stdout = (m.stdout as string) ?? ''
      const stderr = (m.stderr as string) ?? ''
      const exitCode = (m.exitCode as number) ?? 1
      const error = m.error as string | undefined
      const success = exitCode === 0

      let display: DisplayItem[] | undefined
      let actions: HookActions | undefined
      let configUpdates: ConfigUpdate[] | undefined

      // Attempt to parse stdout as JSON for display/actions/configUpdates
      if (stdout.trim()) {
        try {
          const parsed = JSON.parse(stdout.trim())
          if (parsed && typeof parsed === 'object') {
            if (parsed.display) {
              display = normalizeDisplay(parsed.display)
            }
            if (parsed.actions) actions = parsed.actions
            if (Array.isArray(parsed.configUpdates)) {
              configUpdates = parsed.configUpdates.filter(
                /* eslint-disable @typescript-eslint/no-explicit-any */
                (entry: unknown): entry is ConfigUpdate =>
                  entry != null &&
                  typeof entry === 'object' &&
                  typeof (entry as ConfigUpdate).itemId === 'string' &&
                  ((entry as any).content === undefined ||
                    typeof (entry as any).content === 'string') &&
                  ((entry as any).value === undefined || typeof (entry as any).value === 'string')
                /* eslint-enable @typescript-eslint/no-explicit-any */
              )
            }
          }
        } catch {
          // Not valid JSON — ignore, stdout is still captured as raw text
        }
      }

      pending.resolve({
        hookId: pending.hookId,
        hookLabel: pending.hookLabel,
        success,
        error: error ?? (success ? undefined : `Process exited with code ${exitCode}`),
        stdout,
        stderr,
        display,
        actions,
        configUpdates
      })
      return
    }
  })

  runner.on('exit', () => {
    runner = null
    stopHeartbeat()

    // Reject all pending requests — runner died
    for (const [id, pending] of pendingRequests) {
      pendingRequests.delete(id)
      clearTimeout(pending.timeoutId)
      if (pending.contextTempFile) {
        try {
          fs.unlinkSync(pending.contextTempFile)
        } catch {
          /* ignore */
        }
      }
      pending.resolve({
        hookId: pending.hookId,
        hookLabel: pending.hookLabel,
        success: false,
        error: 'Hook runner process crashed'
      })
    }
  })

  startHeartbeat()
}

function startHeartbeat(): void {
  stopHeartbeat()
  heartbeatTimer = setInterval(() => {
    if (runner?.connected) {
      runner.send({ type: 'heartbeat' })
    }
  }, HEARTBEAT_INTERVAL)
}

function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
}

function ensureRunner(): void {
  if (!runner || !runner.connected) {
    spawnRunner()
  }
}

/** Initialize the hook runner. Called at app startup. */
export function initHookRunner(): void {
  ensureRunner()
}

/** Shut down the hook runner. Called at app quit. */
export function shutdownHookRunner(): void {
  stopHeartbeat()
  if (runner) {
    runner.kill()
    runner = null
  }
  // Reject any pending requests
  for (const [id, pending] of pendingRequests) {
    pendingRequests.delete(id)
    clearTimeout(pending.timeoutId)
    if (pending.contextTempFile) {
      try {
        fs.unlinkSync(pending.contextTempFile)
      } catch {
        /* ignore */
      }
    }
    pending.resolve({
      hookId: pending.hookId,
      hookLabel: pending.hookLabel,
      success: false,
      error: 'Hook runner shut down'
    })
  }
}

// ─── Hook execution ───

let requestCounter = 0

/**
 * Execute a single hook script via the persistent hook runner.
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

  // Prepare context JSON: strip file-replace content to reduce size for non-builtIn hooks.
  // Built-in hooks (e.g. sync-config) need the real content to detect changes on disk.
  const hookContext: HookContext = hook.builtIn
    ? context
    : {
        ...context,
        profile: {
          ...context.profile,
          items: context.profile.items.map((item) =>
            item.type === 'file-replace' ? { ...item, content: '<stripped>' } : item
          )
        }
      }
  const contextJson = JSON.stringify(hookContext)

  // Build env object: only XOAY_HOOK_CONTEXT or XOAY_HOOK_CONTEXT_FILE
  // The runner already inherits process.env from spawn time.
  let contextTempFile: string | undefined
  const env: Record<string, string> = {}
  if (Buffer.byteLength(contextJson, 'utf-8') > MAX_ENV_SIZE) {
    contextTempFile = path.join(os.tmpdir(), `xoay-hook-context-${Date.now()}-${hook.id}.json`)
    fs.writeFileSync(contextTempFile, contextJson, 'utf-8')
    env.XOAY_HOOK_CONTEXT_FILE = contextTempFile
  } else {
    env.XOAY_HOOK_CONTEXT = contextJson
  }

  // Ensure runner is alive
  ensureRunner()

  const id = `hook-${++requestCounter}-${Date.now()}`

  return new Promise<HookResult>((resolve) => {
    // Timeout: kill runner and reject this request
    const timeoutId = setTimeout(() => {
      const pending = pendingRequests.get(id)
      if (!pending) return
      pendingRequests.delete(id)
      if (pending.contextTempFile) {
        try {
          fs.unlinkSync(pending.contextTempFile)
        } catch {
          /* ignore */
        }
      }
      // Kill the runner — it will be respawned on next call
      if (runner) {
        runner.kill()
        runner = null
        stopHeartbeat()
      }
      resolve({
        hookId: hook.id,
        hookLabel: hook.label,
        success: false,
        error: `Hook timed out after ${timeout}ms`
      })
    }, timeout)

    pendingRequests.set(id, {
      resolve,
      hookId: hook.id,
      hookLabel: hook.label,
      timeoutId,
      contextTempFile
    })

    // Send run message to the runner.
    // env carries XOAY_HOOK_CONTEXT or XOAY_HOOK_CONTEXT_FILE — the runner
    // applies env into process.env before executing the script.
    try {
      runner!.send({
        type: 'run',
        id,
        scriptPath: resolvedPath,
        env
      })
    } catch (err) {
      pendingRequests.delete(id)
      clearTimeout(timeoutId)
      if (contextTempFile) {
        try {
          fs.unlinkSync(contextTempFile)
        } catch {
          /* ignore */
        }
      }
      resolve({
        hookId: hook.id,
        hookLabel: hook.label,
        success: false,
        error: `Failed to send to runner: ${err instanceof Error ? err.message : String(err)}`
      })
    }
  })
}

/**
 * Normalize display data: detect old Record<string, HookDisplayValue> format
 * and convert to DisplayItem[]. If already an array, use as-is.
 */
function normalizeDisplay(display: unknown): DisplayItem[] {
  // New format: already an array — filter to valid items only
  if (Array.isArray(display)) {
    return display.filter(
      (item): item is DisplayItem =>
        item != null && typeof item === 'object' && typeof item.type === 'string'
    )
  }

  // Old format: Record<string, HookDisplayValue> — object with values that don't have `type` field
  if (display && typeof display === 'object') {
    const items: DisplayItem[] = []
    for (const [key, val] of Object.entries(display as Record<string, HookDisplayValue>)) {
      if (val && typeof val === 'object') {
        items.push({
          type: 'text',
          label: val.label ?? key,
          value: val.value,
          status: val.status
        })
      }
    }
    return items
  }

  return []
}

/**
 * Merge display data from hook results into AppState.hookDisplayData[profileId].
 * New format: replaces the entire DisplayItem[] per profile.
 *
 * Detects status transitions (ok→warning, ok→error, warning→error) and fires
 * system notifications to alert the user.
 */
export function mergeDisplayData(profileId: string, display: DisplayItem[]): void {
  const allDisplayData = getHookDisplayData()
  const existing = allDisplayData[profileId] ?? []

  // Detect status transitions before replacing
  const profile = getProfile(profileId)
  const profileName = profile?.name ?? profileId

  for (const item of display) {
    if (item.value !== null && item.status) {
      // Find matching old item by label for transition detection
      const oldItem = existing.find((e) => e.label === item.label)
      const oldStatus = oldItem?.status ?? 'ok'
      const newStatus = item.status
      const isDegraded =
        (oldStatus === 'ok' && (newStatus === 'warning' || newStatus === 'error')) ||
        (oldStatus === 'warning' && newStatus === 'error')

      if (isDegraded) {
        showSystemNotification('Xoay', `${profileName} ${item.label} dropped to ${item.value}`)
      }
    }
  }

  allDisplayData[profileId] = display
  store.set('hookDisplayData', allDisplayData)

  // Store per-profile timestamp of last successful hook display update
  const timestamps = (store.get('hookDisplayTimestamps') as Record<string, number>) ?? {}
  timestamps[profileId] = Date.now()
  store.set('hookDisplayTimestamps', timestamps)

  // Push updated display data to all renderer windows in real-time
  sendToRenderer('hook:display-update', {
    profileId,
    displayData: display,
    updatedAt: timestamps[profileId]
  })

  // Rebuild tray menu so quota info is visible in system tray
  buildTrayMenu()
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
  hookType: ProfileHook['type'],
  triggeringProfileId?: string
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
          triggeringProfileId,
          triggeredBy: result.hookLabel
        })
      } else if (actions.switchToNextProfile) {
        console.log(
          `[hook-executor] Auto-switch to next profile triggered by hook "${result.hookLabel}"`
        )
        autoSwitchHandler({
          type: 'switchToNextProfile',
          triggeringProfileId,
          triggeredBy: result.hookLabel
        })
      }
    }
  } else if (!switchAllowed && (actions.switchToNextProfile || actions.switchToProfile)) {
    console.log(
      `[hook-executor] Switch action from hook "${result.hookLabel}" ignored — not allowed from "${hookType}" hooks`
    )
  }

  // Notify action: emit to renderer + system notification
  if (actions.notify) {
    sendToRenderer('hook:notify', {
      message: actions.notify,
      hookLabel: result.hookLabel
    })
    showSystemNotification('Xoay', actions.notify)
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

/**
 * Show a macOS system notification if supported and no app window is focused.
 */
function showSystemNotification(title: string, body: string): void {
  if (!Notification.isSupported()) return
  if (BrowserWindow.getAllWindows().some((w) => w.isFocused())) return
  new Notification({ title, body }).show()
}
