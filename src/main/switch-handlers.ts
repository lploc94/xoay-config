import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../shared/types'
import type { IpcResponse, SwitchResult } from '../shared/types'
import { getProfile, getActiveProfileId, setActiveProfileId } from './storage'
import { switchEngine } from './switch-engine'
import { buildTrayMenu } from './tray'
import { syncProfile } from './anchor-sync'

const engine = switchEngine

/**
 * Register all IPC handlers for the switch engine.
 * Call this once during app initialization.
 */
export function registerSwitchHandlers(): void {
  // config:switch — switch to a profile
  ipcMain.handle(
    IPC_CHANNELS.CONFIG_SWITCH,
    async (_event, payload: { profileId: string }): Promise<IpcResponse<SwitchResult>> => {
      try {
        const profile = getProfile(payload.profileId)
        if (!profile) {
          return { success: false, error: `Profile not found: ${payload.profileId}` }
        }

        // Sync active profile before switching (best-effort — never block switch)
        const activeId = getActiveProfileId()
        if (activeId) {
          try {
            await syncProfile(activeId)
          } catch (err) {
            console.error('Sync before switch failed (continuing):', err)
          }
        }

        const result = await engine.switch(profile)

        // Update active profile ID in store
        if (result.success) {
          setActiveProfileId(profile.id)
          buildTrayMenu()
        }

        return {
          success: result.success,
          data: result,
          error: result.success ? undefined : 'Some items failed'
        }
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err)
        }
      }
    }
  )
}
