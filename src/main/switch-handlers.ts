import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../shared/types'
import type { IpcResponse, SwitchResult } from '../shared/types'
import { orchestrateSwitch } from './switch-orchestrator'

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
        const result = await orchestrateSwitch(payload.profileId)

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
