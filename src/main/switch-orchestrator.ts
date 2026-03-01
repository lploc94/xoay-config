import { getProfile, getActiveProfileId, setActiveProfileId, listProfiles } from './storage'
import { switchEngine } from './switch-engine'
import { syncProfile } from './anchor-sync'
import { executeHook, mergeDisplayData, processHookActions, setAutoSwitchHandler, setIsSwitching } from './hook-executor'
import { startCronHooks, stopCronHooks } from './cron-scheduler'
import { buildTrayMenu } from './tray'
import type { Profile, ProfileHook, HookResult, SwitchResult } from '../shared/types'

// Register auto-switch handler (avoids circular import: hook-executor → switch-orchestrator)
setAutoSwitchHandler((request) => {
  let targetProfileId: string | undefined

  if (request.type === 'switchToProfile' && request.profileId) {
    targetProfileId = request.profileId
  } else if (request.type === 'switchToNextProfile') {
    const profiles = listProfiles()
    const activeId = getActiveProfileId()
    if (profiles.length < 2) return
    const currentIdx = profiles.findIndex((p) => p.id === activeId)
    const nextIdx = (currentIdx + 1) % profiles.length
    targetProfileId = profiles[nextIdx].id
  }

  if (!targetProfileId) return

  // Fire-and-forget — errors are logged but not propagated
  orchestrateSwitch(targetProfileId).catch((err) => {
    console.error(`[switch-orchestrator] Auto-switch failed:`, err)
  })
})

/**
 * Run a list of hooks (best-effort). Failures are captured but never thrown.
 */
async function runHooks(
  hooks: ProfileHook[],
  hookType: ProfileHook['type'],
  profile: Profile
): Promise<HookResult[]> {
  const matching = hooks.filter((h) => h.enabled && h.type === hookType)
  const results: HookResult[] = []

  for (const hook of matching) {
    try {
      const result = await executeHook(hook, {
        profileId: profile.id,
        profileName: profile.name,
        hookType,
        profile
      })
      // Merge display data if present
      if (result.display) {
        mergeDisplayData(profile.id, result.display)
      }
      // Process actions (notify, auto-switch, etc.)
      processHookActions(result, hookType)
      results.push(result)
    } catch (err) {
      results.push({
        hookId: hook.id,
        hookLabel: hook.label,
        success: false,
        error: `Unexpected error: ${err instanceof Error ? err.message : String(err)}`
      })
    }
  }

  return results
}

/**
 * Orchestrate a full profile switch with hooks at all lifecycle points.
 *
 * Flow:
 * 1. Stop cron hooks for OLD profile
 * 2. Run pre-switch-out hooks on OLD profile
 * 3. Sync active profile (best-effort)
 * 4. Run post-switch-out hooks on OLD profile
 * 5. switchEngine.switch(newProfile) — files replaced here
 * 6. Run pre-switch-in hooks on NEW profile
 * 7. Update activeProfileId
 * 8. Run post-switch-in hooks on NEW profile
 * 9. Start cron hooks for NEW profile
 * 10. Return SwitchResult with hookResults
 */
export async function orchestrateSwitch(profileId: string): Promise<SwitchResult> {
  const profile = getProfile(profileId)
  if (!profile) {
    throw new Error(`Profile not found: ${profileId}`)
  }

  setIsSwitching(true)
  try {
    const allHookResults: HookResult[] = []
    const oldProfileId = getActiveProfileId()
    const oldProfile = oldProfileId ? getProfile(oldProfileId) : null

    // Steps 1-4: Old profile hooks (only if there is an active profile)
    if (oldProfile) {
      // Step 1: Stop cron hooks for OLD profile
      stopCronHooks()

      // Step 2: pre-switch-out hooks on OLD profile
      const preOutResults = await runHooks(oldProfile.hooks, 'pre-switch-out', oldProfile)
      allHookResults.push(...preOutResults)

      // Step 3: Sync active profile (best-effort)
      try {
        await syncProfile(oldProfileId!)
      } catch (err) {
        console.error('Sync before switch failed (continuing):', err)
      }

      // Step 4: post-switch-out hooks on OLD profile
      const postOutResults = await runHooks(oldProfile.hooks, 'post-switch-out', oldProfile)
      allHookResults.push(...postOutResults)
    }

    // Step 5: switchEngine.switch(newProfile) — files replaced here
    const result = await switchEngine.switch(profile)

    // Steps 6-9: New profile hooks (only if switch succeeded)
    if (result.success) {
      // Step 6: pre-switch-in hooks on NEW profile
      const preInResults = await runHooks(profile.hooks, 'pre-switch-in', profile)
      allHookResults.push(...preInResults)

      // Step 7: Update activeProfileId
      setActiveProfileId(profile.id)

      // Step 8: post-switch-in hooks on NEW profile
      const postInResults = await runHooks(profile.hooks, 'post-switch-in', profile)
      allHookResults.push(...postInResults)

      // Step 9: Start cron hooks for NEW profile
      startCronHooks(profile.id)
    }

    // Step 10: Build tray menu & return result with hookResults
    buildTrayMenu()

    return {
      ...result,
      hookResults: allHookResults.length > 0 ? allHookResults : undefined
    }
  } finally {
    setIsSwitching(false)
  }
}
