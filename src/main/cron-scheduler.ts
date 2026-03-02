import { getProfile } from './storage'
import { executeHook, mergeDisplayData, processHookActions } from './hook-executor'
import type { ProfileHook, HookContext } from '../shared/types'

const MIN_INTERVAL_MS = 10_000

/** Active interval handles keyed by `${profileId}:${hookId}` */
const activeIntervals = new Map<string, ReturnType<typeof setInterval>>()

/** Track which profiles have active crons */
const activeProfileIds = new Set<string>()

function intervalKey(profileId: string, hookId: string): string {
  return `${profileId}:${hookId}`
}

/**
 * Start all enabled cron hooks for the given profile.
 * This is additive — it does not stop crons for other profiles.
 * Safe to call multiple times for different profiles.
 */
export function startCronHooks(profileId: string): void {
  // Stop any existing crons for THIS profile only (avoid duplicates)
  stopCronHooks(profileId)

  const profile = getProfile(profileId)
  if (!profile) {
    console.error(`[cron-scheduler] Profile not found: ${profileId}`)
    return
  }

  activeProfileIds.add(profileId)

  const cronHooks = profile.hooks.filter(
    (h): h is ProfileHook & { type: 'cron' } => h.type === 'cron' && h.enabled
  )

  if (cronHooks.length === 0) return

  console.log(
    `[cron-scheduler] Starting ${cronHooks.length} cron hook(s) for profile "${profile.name}"`
  )

  for (const hook of cronHooks) {
    const interval = Math.max(hook.cronIntervalMs ?? 60_000, MIN_INTERVAL_MS)

    const runHook = async (): Promise<void> => {
      // Re-check profile is still tracked
      if (!activeProfileIds.has(profileId)) return

      const currentProfile = getProfile(profileId)
      if (!currentProfile) return

      // Re-check hook is still enabled (user may have disabled it via UI)
      const currentHook = currentProfile.hooks.find((h) => h.id === hook.id)
      if (!currentHook || !currentHook.enabled) {
        console.log(`[cron-scheduler] Hook "${hook.label}" disabled or removed — stopping`)
        const key = intervalKey(profileId, hook.id)
        const handle = activeIntervals.get(key)
        if (handle) {
          clearInterval(handle)
          activeIntervals.delete(key)
        }
        return
      }

      const context: HookContext = {
        profileId,
        profileName: currentProfile.name,
        hookType: 'cron',
        profile: currentProfile
      }

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
            `[cron-scheduler] Hook "${hook.label}" failed: ${result.error ?? 'unknown error'}`
          )
        }
      } catch (err) {
        console.error(
          `[cron-scheduler] Hook "${hook.label}" threw unexpectedly:`,
          err
        )
      }
    }

    const key = intervalKey(profileId, hook.id)
    runHook() // Run immediately on start, don't wait for first interval
    const handle = setInterval(runHook, interval)
    activeIntervals.set(key, handle)

    console.log(
      `[cron-scheduler]   → "${hook.label}" every ${interval}ms`
    )
  }
}

/**
 * Stop cron hooks.
 * - If profileId is given, stop only that profile's crons.
 * - If no arg, stop all crons across all profiles.
 */
export function stopCronHooks(profileId?: string): void {
  if (profileId) {
    // Stop only this profile's crons
    const keysToRemove: string[] = []
    for (const [key, handle] of activeIntervals) {
      if (key.startsWith(`${profileId}:`)) {
        clearInterval(handle)
        keysToRemove.push(key)
      }
    }
    if (keysToRemove.length > 0) {
      console.log(`[cron-scheduler] Stopping ${keysToRemove.length} cron hook(s) for profile "${profileId}"`)
      for (const key of keysToRemove) {
        activeIntervals.delete(key)
      }
    }
    activeProfileIds.delete(profileId)
  } else {
    // Stop all crons
    if (activeIntervals.size > 0) {
      console.log(`[cron-scheduler] Stopping all ${activeIntervals.size} cron hook(s)`)
      for (const [, handle] of activeIntervals) {
        clearInterval(handle)
      }
      activeIntervals.clear()
    }
    activeProfileIds.clear()
  }
}
