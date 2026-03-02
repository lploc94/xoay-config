import { getProfile } from './storage'
import { executeHook, mergeDisplayData, processHookActions } from './hook-executor'
import type { ProfileHook, HookContext } from '../shared/types'

const MIN_INTERVAL_MS = 10_000

// ── Profile cron tracking (active-profile-only crons) ───────────

/** Active profile cron interval handles keyed by `${profileId}:${hookId}` */
const activeIntervals = new Map<string, ReturnType<typeof setInterval>>()

/** Track which profiles have active profile crons */
const activeProfileIds = new Set<string>()

// ── Background cron tracking ────────────────────────────────────

/** Active background cron interval handles keyed by `${profileId}:${hookId}` */
const activeBackgroundIntervals = new Map<string, ReturnType<typeof setInterval>>()

/** Track which profiles have active background crons */
const activeBackgroundProfileIds = new Set<string>()

// ── Helpers ─────────────────────────────────────────────────────

function intervalKey(profileId: string, hookId: string): string {
  return `${profileId}:${hookId}`
}

/** Optional switch metadata passed to profile crons on first run. */
interface CronSwitchMetadata {
  freshSwitch?: boolean
  previousProfileId?: string
  previousProfileName?: string
  trigger?: 'switch' | 'startup' | 'schedule'
}

/**
 * Schedule a cron hook into the given tracking structures.
 *
 * When `metadata` is provided (profile crons only), the first immediate run
 * uses those values. Subsequent interval runs default to
 * `trigger: 'schedule'` / `freshSwitch: false`.
 */
function scheduleCronHook(
  profileId: string,
  hook: ProfileHook & { type: 'cron' },
  intervals: Map<string, ReturnType<typeof setInterval>>,
  trackedIds: Set<string>,
  label: string,
  metadata?: CronSwitchMetadata
): void {
  const interval = Math.max(hook.cronIntervalMs ?? 60_000, MIN_INTERVAL_MS)
  let isFirstRun = true

  const runHook = async (): Promise<void> => {
    // Re-check profile is still tracked
    if (!trackedIds.has(profileId)) return

    const currentProfile = getProfile(profileId)
    if (!currentProfile) return

    // Re-check hook is still enabled (user may have disabled it via UI)
    const currentHook = currentProfile.hooks.find((h) => h.id === hook.id)
    if (!currentHook || !currentHook.enabled) {
      console.log(`[cron-scheduler] ${label} hook "${hook.label}" disabled or removed — stopping`)
      const key = intervalKey(profileId, hook.id)
      const handle = intervals.get(key)
      if (handle) {
        clearInterval(handle)
        intervals.delete(key)
      }
      return
    }

    const context: HookContext = {
      profileId,
      profileName: currentProfile.name,
      hookType: 'cron',
      profile: currentProfile,
      ...(isFirstRun && metadata
        ? {
            freshSwitch: metadata.freshSwitch,
            previousProfileId: metadata.previousProfileId,
            previousProfileName: metadata.previousProfileName,
            trigger: metadata.trigger
          }
        : {
            trigger: 'schedule' as const,
            freshSwitch: false
          })
    }

    isFirstRun = false

    try {
      const result = await executeHook(hook, context)

      // Merge display data if present
      if (result.display) {
        mergeDisplayData(profileId, result.display)
      }

      // Process actions (auto-switch, notify) — pass profileId for category-scoped switching
      processHookActions(result, 'cron', profileId)

      if (!result.success) {
        console.error(
          `[cron-scheduler] ${label} hook "${hook.label}" failed: ${result.error ?? 'unknown error'}`
        )
      }
    } catch (err) {
      console.error(
        `[cron-scheduler] ${label} hook "${hook.label}" threw unexpectedly:`,
        err
      )
    }
  }

  const key = intervalKey(profileId, hook.id)
  runHook() // Run immediately on start, don't wait for first interval
  const handle = setInterval(runHook, interval)
  intervals.set(key, handle)

  console.log(
    `[cron-scheduler]   → "${hook.label}" every ${interval}ms (${label})`
  )
}

// ── Profile crons (active-profile-only) ─────────────────────────

/**
 * Start enabled profile cron hooks (non-background) for the given profile.
 * This is additive — it does not stop crons for other profiles.
 * Safe to call multiple times for different profiles.
 *
 * @param metadata  Optional switch metadata forwarded to the first cron run.
 */
export function startCronHooks(profileId: string, metadata?: CronSwitchMetadata): void {
  // Stop any existing profile crons for THIS profile only (avoid duplicates)
  stopCronHooks(profileId)

  const profile = getProfile(profileId)
  if (!profile) {
    console.error(`[cron-scheduler] Profile not found: ${profileId}`)
    return
  }

  activeProfileIds.add(profileId)

  const cronHooks = profile.hooks.filter(
    (h): h is ProfileHook & { type: 'cron' } =>
      h.type === 'cron' && h.enabled && !h.runInBackground
  )

  if (cronHooks.length === 0) return

  console.log(
    `[cron-scheduler] Starting ${cronHooks.length} profile cron hook(s) for "${profile.name}"`
  )

  for (const hook of cronHooks) {
    scheduleCronHook(profileId, hook, activeIntervals, activeProfileIds, 'profile', metadata)
  }
}

/**
 * Stop profile cron hooks (non-background).
 * - If profileId is given, stop only that profile's profile crons.
 * - If no arg, stop all profile crons across all profiles.
 */
export function stopCronHooks(profileId?: string): void {
  if (profileId) {
    // Stop only this profile's profile crons
    const keysToRemove: string[] = []
    for (const [key, handle] of activeIntervals) {
      if (key.startsWith(`${profileId}:`)) {
        clearInterval(handle)
        keysToRemove.push(key)
      }
    }
    if (keysToRemove.length > 0) {
      console.log(`[cron-scheduler] Stopping ${keysToRemove.length} profile cron hook(s) for profile "${profileId}"`)
      for (const key of keysToRemove) {
        activeIntervals.delete(key)
      }
    }
    activeProfileIds.delete(profileId)
  } else {
    // Stop all profile crons
    if (activeIntervals.size > 0) {
      console.log(`[cron-scheduler] Stopping all ${activeIntervals.size} profile cron hook(s)`)
      for (const [, handle] of activeIntervals) {
        clearInterval(handle)
      }
      activeIntervals.clear()
    }
    activeProfileIds.clear()
  }
}

// ── Background crons ────────────────────────────────────────────

/**
 * Start enabled background cron hooks (`runInBackground: true`) for the given profile.
 * Called for ALL profiles on app startup, regardless of active state.
 */
export function startBackgroundCrons(profileId: string): void {
  // Stop any existing background crons for THIS profile only (avoid duplicates)
  stopBackgroundCrons(profileId)

  const profile = getProfile(profileId)
  if (!profile) {
    console.error(`[cron-scheduler] Profile not found: ${profileId}`)
    return
  }

  activeBackgroundProfileIds.add(profileId)

  const bgCronHooks = profile.hooks.filter(
    (h): h is ProfileHook & { type: 'cron' } =>
      h.type === 'cron' && h.enabled && h.runInBackground === true
  )

  if (bgCronHooks.length === 0) return

  console.log(
    `[cron-scheduler] Starting ${bgCronHooks.length} background cron hook(s) for "${profile.name}"`
  )

  for (const hook of bgCronHooks) {
    scheduleCronHook(profileId, hook, activeBackgroundIntervals, activeBackgroundProfileIds, 'background')
  }
}

/**
 * Stop background cron hooks for a specific profile.
 */
export function stopBackgroundCrons(profileId: string): void {
  const keysToRemove: string[] = []
  for (const [key, handle] of activeBackgroundIntervals) {
    if (key.startsWith(`${profileId}:`)) {
      clearInterval(handle)
      keysToRemove.push(key)
    }
  }
  if (keysToRemove.length > 0) {
    console.log(`[cron-scheduler] Stopping ${keysToRemove.length} background cron hook(s) for profile "${profileId}"`)
    for (const key of keysToRemove) {
      activeBackgroundIntervals.delete(key)
    }
  }
  activeBackgroundProfileIds.delete(profileId)
}

/**
 * Stop all background cron hooks across all profiles (used on app quit).
 */
export function stopAllBackgroundCrons(): void {
  if (activeBackgroundIntervals.size > 0) {
    console.log(`[cron-scheduler] Stopping all ${activeBackgroundIntervals.size} background cron hook(s)`)
    for (const [, handle] of activeBackgroundIntervals) {
      clearInterval(handle)
    }
    activeBackgroundIntervals.clear()
  }
  activeBackgroundProfileIds.clear()
}
