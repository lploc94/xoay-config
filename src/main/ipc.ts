import { ipcMain, dialog } from 'electron'
import { IPC_CHANNELS } from '../shared/types'
import type { IpcResponse, Profile, Category, CreateProfileReq, ConfigItem, Preset, ProfileHook, DisplayItem, BuiltinHookInfo } from '../shared/types'
import {
  listProfiles,
  getProfile,
  createProfile,
  updateProfile,
  deleteProfile,
  getAllActiveProfileIds,
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  store,
  getHookDisplayData
} from './storage'
import { getAllPresets, getPresetById } from './presets'
import { importPresetFile, exportPreset } from './preset-loader'
import { importCurrentConfig, autoDetectPresets } from './import-service'
import { getHooksDir, listBuiltinHooks, toRelativeHookPath } from './hook-storage'

function ok<T>(data: T): IpcResponse<T> {
  return { success: true, data }
}

function fail(error: string): IpcResponse<never> {
  return { success: false, error }
}

export function registerIpcHandlers(): void {
  // ── Category CRUD ─────────────────────────────────────────────

  ipcMain.handle(IPC_CHANNELS.CATEGORY_LIST, (): IpcResponse<Category[]> => {
    try {
      return ok(listCategories())
    } catch (e) {
      return fail(String(e))
    }
  })

  ipcMain.handle(
    IPC_CHANNELS.CATEGORY_CREATE,
    (_, { name, icon, builtIn }: { name: string; icon?: string; builtIn?: boolean }): IpcResponse<Category> => {
      try {
        return ok(createCategory(name, { icon, builtIn }))
      } catch (e) {
        return fail(String(e))
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.CATEGORY_UPDATE,
    (_, category: Category): IpcResponse<Category> => {
      try {
        return ok(updateCategory(category))
      } catch (e) {
        return fail(String(e))
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.CATEGORY_DELETE,
    (_, { id }: { id: string }): IpcResponse<void> => {
      try {
        deleteCategory(id)
        return ok(undefined as void)
      } catch (e) {
        return fail(String(e))
      }
    }
  )

  // ── Profile CRUD ─────────────────────────────────────────────

  ipcMain.handle(
    IPC_CHANNELS.PROFILE_LIST,
    (_, payload?: { categoryId?: string }): IpcResponse<Profile[]> => {
      try {
        return ok(listProfiles(payload?.categoryId))
      } catch (e) {
        return fail(String(e))
      }
    }
  )

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

  ipcMain.handle(IPC_CHANNELS.PROFILE_GET_ACTIVE, (): IpcResponse<Record<string, string>> => {
    try {
      return ok(getAllActiveProfileIds())
    } catch (e) {
      return fail(String(e))
    }
  })

  // ── Presets ──────────────────────────────────────────────────

  ipcMain.handle(IPC_CHANNELS.PRESET_LIST, (): IpcResponse<Preset[]> => {
    return ok(getAllPresets())
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

  // ── Preset Import / Export ───────────────────────────────────

  ipcMain.handle(
    IPC_CHANNELS.PRESET_IMPORT,
    async (): Promise<IpcResponse<{ preset: Preset; category: Category } | null>> => {
      try {
        const result = await dialog.showOpenDialog({
          title: 'Import Preset',
          filters: [{ name: 'Xoay Preset', extensions: ['xoay-preset.json'] }],
          properties: ['openFile']
        })
        if (result.canceled || result.filePaths.length === 0) {
          return ok(null)
        }
        const imported = importPresetFile(result.filePaths[0])
        if (!imported) {
          return fail('Invalid preset file')
        }
        return ok(imported)
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e))
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.PRESET_EXPORT,
    async (_, { presetId }: { presetId: string }): Promise<IpcResponse<boolean>> => {
      try {
        const preset = getPresetById(presetId)
        if (!preset) return fail(`Preset not found: ${presetId}`)

        // Find category name from preset or from profiles using this preset
        const categoryName = preset.categoryName ?? 'Uncategorized'

        // Collect hooks from profiles that use this preset
        const allProfiles = listProfiles()
        const hooks = allProfiles
          .filter((p) => p.presetId === presetId)
          .flatMap((p) => p.hooks)

        const result = await dialog.showSaveDialog({
          title: 'Export Preset',
          defaultPath: `${preset.name}.xoay-preset.json`,
          filters: [{ name: 'Xoay Preset', extensions: ['xoay-preset.json'] }]
        })
        if (result.canceled || !result.filePath) {
          return ok(false)
        }

        exportPreset(preset, hooks, categoryName, result.filePath)
        return ok(true)
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e))
      }
    }
  )

  // ── Import Current Config ─────────────────────────────────────

  ipcMain.handle(
    IPC_CHANNELS.CONFIG_IMPORT_CURRENT,
    async (
      _,
      payload: { name: string; categoryId: string; presetId?: string }
    ): Promise<IpcResponse<Profile>> => {
      try {
        const items = await importCurrentConfig(payload.presetId)

        if (items.length === 0) {
          return fail('No config files found on disk for the selected preset')
        }

        const profile = createProfile({
          name: payload.name,
          categoryId: payload.categoryId,
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
        const hook = profile.hooks.find((h) => h.id === hookId)
        if (hook?.builtIn) {
          console.warn(`[ipc] Attempted to delete built-in hook: ${hookId}`)
          return fail('Cannot delete a built-in hook')
        }
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
    (): IpcResponse<Record<string, DisplayItem[]>> => {
      try {
        return ok(getHookDisplayData())
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

  ipcMain.handle(
    IPC_CHANNELS.HOOK_GET_DISPLAY_TIMESTAMPS,
    (): IpcResponse<Record<string, number>> => {
      try {
        const data = (store.get('hookDisplayTimestamps') as Record<string, number>) ?? {}
        return ok(data)
      } catch (e) {
        return fail(String(e))
      }
    }
  )
}
