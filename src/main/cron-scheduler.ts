import { getProfile } from './storage'
import { executeHook, mergeDisplayData, processHookActions } from './hook-executor'
import type { ProfileHook, HookContext } from '../shared/types'

const MIN_INTERVAL_MS = 10_000

/** Active interval handles keyed by hook ID */
const activeIntervals = new Map<string, ReturnType<typeof setInterval>>()

let activeProfileId: string | null = null

/**
 * Start all enabled cron hooks for the given profile.
 * Each hook runs independently on its own setInterval.
 * Call stopCronHooks() before calling this to avoid duplicates.
 */
export function startCronHooks(profileId: string): void {
  // Safety: stop any existing cron hooks first
  stopCronHooks()

  const profile = getProfile(profileId)
  if (!profile) {
    console.error(`[cron-scheduler] Profile not found: ${profileId}`)
    return
  }

  activeProfileId = profileId

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
      // Re-check profile is still active (guard against race conditions)
      if (activeProfileId !== profileId) return

      const currentProfile = getProfile(profileId)
      if (!currentProfile) return

      // Re-check hook is still enabled (user may have disabled it via UI)
      const currentHook = currentProfile.hooks.find((h) => h.id === hook.id)
      if (!currentHook || !currentHook.enabled) {
        console.log(`[cron-scheduler] Hook "${hook.label}" disabled or removed — stopping`)
        const handle = activeIntervals.get(hook.id)
        if (handle) {
          clearInterval(handle)
          activeIntervals.delete(hook.id)
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

        // Process actions (auto-switch, notify)
        processHookActions(result, 'cron')

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

    const handle = setInterval(runHook, interval)
    activeIntervals.set(hook.id, handle)

    console.log(
      `[cron-scheduler]   → "${hook.label}" every ${interval}ms`
    )
  }
}

/**
 * Stop all running cron hooks. Safe to call even if none are running.
 */
export function stopCronHooks(): void {
  if (activeIntervals.size > 0) {
    console.log(`[cron-scheduler] Stopping ${activeIntervals.size} cron hook(s)`)
    for (const [, handle] of activeIntervals) {
      clearInterval(handle)
    }
    activeIntervals.clear()
  }
  activeProfileId = null
}
