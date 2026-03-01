import { ipcMain, dialog } from 'electron'
import { IPC_CHANNELS } from '../shared/types'
import type { IpcResponse, Profile, CreateProfileReq, ConfigItem, Preset, SyncResult, ProfileHook, HookDisplayValue, BuiltinHookInfo } from '../shared/types'
import {
  listProfiles,
  getProfile,
  createProfile,
  updateProfile,
  deleteProfile,
  getActiveProfileId,
  store
} from './storage'
import { PRESETS, getPresetById } from './presets'
import { importCurrentConfig, autoDetectPresets } from './import-service'
import { syncProfile } from './anchor-sync'
import { getHooksDir, listBuiltinHooks, toRelativeHookPath } from './hook-storage'

function ok<T>(data: T): IpcResponse<T> {
  return { success: true, data }
}

function fail(error: string): IpcResponse<never> {
  return { success: false, error }
}

export function registerIpcHandlers(): void {
  // ── Profile CRUD ─────────────────────────────────────────────

  ipcMain.handle(IPC_CHANNELS.PROFILE_LIST, (): IpcResponse<Profile[]> => {
    try {
      return ok(listProfiles())
    } catch (e) {
      return fail(String(e))
    }
  })

  ipcMain.handle(
    IPC_CHANNELS.PROFILE_GET,
    (_, { id }: { id: string }): IpcResponse<Profile | null> => {
      try {
        return ok(getProfile(id))
      } catch (e) {
        return fail(String(e))
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.PROFILE_CREATE,
    (_, req: CreateProfileReq): IpcResponse<Profile> => {
      try {
        return ok(createProfile(req))
      } catch (e) {
        return fail(String(e))
      }
    }
  )

  ipcMain.handle(IPC_CHANNELS.PROFILE_UPDATE, (_, profile: Profile): IpcResponse<Profile> => {
    try {
      return ok(updateProfile(profile))
    } catch (e) {
      return fail(String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.PROFILE_DELETE, (_, { id }: { id: string }): IpcResponse<void> => {
    try {
      deleteProfile(id)
      return ok(undefined as void)
    } catch (e) {
      return fail(String(e))
    }
  })

  ipcMain.handle(IPC_CHANNELS.PROFILE_GET_ACTIVE, (): IpcResponse<string | null> => {
    try {
      return ok(getActiveProfileId())
    } catch (e) {
      return fail(String(e))
    }
  })

  // ── Presets ──────────────────────────────────────────────────

  ipcMain.handle(IPC_CHANNELS.PRESET_LIST, (): IpcResponse<Preset[]> => {
    return ok(PRESETS)
  })

  ipcMain.handle(
    IPC_CHANNELS.PRESET_GET_ITEMS,
    (_, { presetId }: { presetId: string }): IpcResponse<ConfigItem[]> => {
      const preset = getPresetById(presetId)
      if (!preset) {
        return fail(`Preset not found: ${presetId}`)
      }
      return ok(preset.defaultItems)
    }
  )

  // ── Import Current Config ─────────────────────────────────────

  ipcMain.handle(
    IPC_CHANNELS.CONFIG_IMPORT_CURRENT,
    async (
      _,
      payload: { name: string; presetId?: string }
    ): Promise<IpcResponse<Profile>> => {
      try {
        const items = await importCurrentConfig(payload.presetId)

        if (items.length === 0) {
          return fail('No config files found on disk for the selected preset')
        }

        const profile = createProfile({
          name: payload.name,
          presetId: payload.presetId,
          items
        })

        return ok(profile)
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e))
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.IMPORT_AUTO_DETECT,
    async (): Promise<IpcResponse<string[]>> => {
      try {
        return ok(await autoDetectPresets())
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e))
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.IMPORT_PREVIEW,
    async (_, payload: { presetId?: string }): Promise<IpcResponse<ConfigItem[]>> => {
      try {
        return ok(await importCurrentConfig(payload.presetId))
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e))
      }
    }
  )

  // ── Sync ────────────────────────────────────────────────────────

  ipcMain.handle(
    IPC_CHANNELS.SYNC_PROFILE,
    async (_, { profileId }: { profileId: string }): Promise<IpcResponse<{ results: SyncResult[] }>> => {
      try {
        const results = await syncProfile(profileId)
        return ok({ results })
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e))
      }
    }
  )

  // ── Hooks ──────────────────────────────────────────────────────

  ipcMain.handle(
    IPC_CHANNELS.HOOK_ADD,
    (_, { profileId, hook }: { profileId: string; hook: ProfileHook }): IpcResponse<Profile> => {
      try {
        const profile = getProfile(profileId)
        if (!profile) return fail(`Profile not found: ${profileId}`)
        profile.hooks.push(hook)
        return ok(updateProfile(profile))
      } catch (e) {
        return fail(String(e))
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.HOOK_UPDATE,
    (_, { profileId, hook }: { profileId: string; hook: ProfileHook }): IpcResponse<Profile> => {
      try {
        const profile = getProfile(profileId)
        if (!profile) return fail(`Profile not found: ${profileId}`)
        const idx = profile.hooks.findIndex((h) => h.id === hook.id)
        if (idx === -1) return fail(`Hook not found: ${hook.id}`)
        profile.hooks[idx] = hook
        return ok(updateProfile(profile))
      } catch (e) {
        return fail(String(e))
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.HOOK_DELETE,
    (_, { profileId, hookId }: { profileId: string; hookId: string }): IpcResponse<Profile> => {
      try {
        const profile = getProfile(profileId)
        if (!profile) return fail(`Profile not found: ${profileId}`)
        profile.hooks = profile.hooks.filter((h) => h.id !== hookId)
        return ok(updateProfile(profile))
      } catch (e) {
        return fail(String(e))
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.HOOK_SELECT_FILE,
    async (): Promise<IpcResponse<string | null>> => {
      try {
        const result = await dialog.showOpenDialog({
          title: 'Select Hook Script',
          defaultPath: getHooksDir(),
          filters: [{ name: 'JavaScript', extensions: ['js'] }],
          properties: ['openFile']
        })
        if (result.canceled || result.filePaths.length === 0) {
          return ok(null)
        }
        // Store relative path if inside hooks dir, absolute otherwise
        return ok(toRelativeHookPath(result.filePaths[0]))
      } catch (e) {
        return fail(String(e))
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.HOOK_GET_DISPLAY_DATA,
    (): IpcResponse<Record<string, Record<string, HookDisplayValue>>> => {
      try {
        const data = (store.get('hookDisplayData') as Record<string, Record<string, HookDisplayValue>>) ?? {}
        return ok(data)
      } catch (e) {
        return fail(String(e))
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.HOOK_LIST_BUILTIN,
    (): IpcResponse<BuiltinHookInfo[]> => {
      try {
        return ok(listBuiltinHooks())
      } catch (e) {
        return fail(String(e))
      }
    }
  )
}
