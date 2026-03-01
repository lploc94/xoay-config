import type {
  Profile,
  CreateProfileReq,
  ConfigItem,
  Preset,
  SwitchResult,
  SyncResult,
  ProfileHook,
  HookDisplayValue,
  BuiltinHookInfo,
  IpcResponse
} from '../../../shared/types'
import { IPC_CHANNELS } from '../../../shared/types'

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  // Strip Svelte 5 reactive proxies — IPC structured clone cannot handle them
  const plainArgs = args.map(a => JSON.parse(JSON.stringify(a)))
  const resp: IpcResponse<T> = await window.electron.ipcRenderer.invoke(channel, ...plainArgs)
  if (!resp.success) {
    throw new Error(resp.error ?? 'Unknown error')
  }
  return resp.data as T
}

// ── Profile CRUD ─────────────────────────────────────────────
export const listProfiles = () => invoke<Profile[]>(IPC_CHANNELS.PROFILE_LIST)
export const getProfile = (id: string) => invoke<Profile | null>(IPC_CHANNELS.PROFILE_GET, { id })
export const createProfile = (req: CreateProfileReq) =>
  invoke<Profile>(IPC_CHANNELS.PROFILE_CREATE, req)
export const updateProfile = (profile: Profile) =>
  invoke<Profile>(IPC_CHANNELS.PROFILE_UPDATE, profile)
export const deleteProfile = (id: string) => invoke<void>(IPC_CHANNELS.PROFILE_DELETE, { id })
export const getActiveProfileId = () =>
  invoke<string | null>(IPC_CHANNELS.PROFILE_GET_ACTIVE)

// ── Presets ──────────────────────────────────────────────────
export const listPresets = () => invoke<Preset[]>(IPC_CHANNELS.PRESET_LIST)
export const getPresetItems = (presetId: string) =>
  invoke<ConfigItem[]>(IPC_CHANNELS.PRESET_GET_ITEMS, { presetId })

// ── Switch ───────────────────────────────────────────────────
export const switchConfig = (profileId: string) =>
  invoke<SwitchResult>(IPC_CHANNELS.CONFIG_SWITCH, { profileId })

// ── Import ───────────────────────────────────────────────────
export const importCurrentConfig = (name: string, presetId?: string) =>
  invoke<Profile>(IPC_CHANNELS.CONFIG_IMPORT_CURRENT, { name, presetId })
export const autoDetectPresets = () => invoke<string[]>(IPC_CHANNELS.IMPORT_AUTO_DETECT)
export const importPreview = (presetId?: string) =>
  invoke<ConfigItem[]>(IPC_CHANNELS.IMPORT_PREVIEW, { presetId })

// ── Sync ────────────────────────────────────────────────────
export const syncProfile = (profileId: string) =>
  invoke<{ results: SyncResult[] }>(IPC_CHANNELS.SYNC_PROFILE, { profileId })

// ── Hooks ──────────────────────────────────────────────────
export const addHook = (profileId: string, hook: ProfileHook) =>
  invoke<Profile>(IPC_CHANNELS.HOOK_ADD, { profileId, hook })
export const updateHook = (profileId: string, hook: ProfileHook) =>
  invoke<Profile>(IPC_CHANNELS.HOOK_UPDATE, { profileId, hook })
export const deleteHook = (profileId: string, hookId: string) =>
  invoke<Profile>(IPC_CHANNELS.HOOK_DELETE, { profileId, hookId })
export const selectHookFile = () =>
  invoke<string | null>(IPC_CHANNELS.HOOK_SELECT_FILE)
export const getHookDisplayData = () =>
  invoke<Record<string, Record<string, HookDisplayValue>>>(IPC_CHANNELS.HOOK_GET_DISPLAY_DATA)
export const listBuiltinHooks = () =>
  invoke<BuiltinHookInfo[]>(IPC_CHANNELS.HOOK_LIST_BUILTIN)

// ── Events from main ────────────────────────────────────────
export function onProfileSwitched(callback: (result: SwitchResult) => void): () => void {
  const handler = (_event: unknown, result: SwitchResult): void => {
    callback(result)
  }
  window.electron.ipcRenderer.on('profile:switched', handler)
  return () => {
    window.electron.ipcRenderer.removeListener('profile:switched', handler)
  }
}

export function onHookNotify(callback: (data: { message: string; hookLabel: string }) => void): () => void {
  const handler = (_event: unknown, data: { message: string; hookLabel: string }): void => {
    callback(data)
  }
  window.electron.ipcRenderer.on('hook:notify', handler)
  return () => {
    window.electron.ipcRenderer.removeListener('hook:notify', handler)
  }
}
