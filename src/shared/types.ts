// ── Anchor Types ─────────────────────────────────────────────────

export interface JsonPathAnchor {
  type: 'json-path'
  path: string
  value: string
}

export interface EnvValueAnchor {
  type: 'env-value'
  name: string
  value: string
}

export interface LineContentAnchor {
  type: 'line-content'
  line: number
  value: string
}

export type AnchorConfig = JsonPathAnchor | EnvValueAnchor | LineContentAnchor

// ── Config Item Types ─────────────────────────────────────────────

export interface BaseConfigItem {
  id: string
  label: string
  enabled: boolean
}

export interface FileReplaceItem extends BaseConfigItem {
  type: 'file-replace'
  targetPath: string
  content: string
  anchor?: AnchorConfig
}

export interface EnvVarItem extends BaseConfigItem {
  type: 'env-var'
  name: string
  value: string
  shellFile: string
  anchor?: AnchorConfig
}

export interface RunCommandItem extends BaseConfigItem {
  type: 'run-command'
  command: string
  workingDir?: string
  timeout?: number // ms, default 30000
}

export type ConfigItem = FileReplaceItem | EnvVarItem | RunCommandItem

// ── Profile ──────────────────────────────────────────────────────

export interface Profile {
  id: string
  name: string
  presetId?: string
  items: ConfigItem[]
  createdAt: string
  updatedAt: string
}

// ── Preset ───────────────────────────────────────────────────────

export interface Preset {
  id: string
  name: string
  description: string
  defaultItems: ConfigItem[]
}

// ── Switch Result ────────────────────────────────────────────────

export interface ItemResult {
  itemId: string
  type?: ConfigItem['type']
  label?: string
  success: boolean
  error?: string
  stdout?: string
  stderr?: string
}

export interface SwitchResult {
  profileId: string
  backupId: string
  results: ItemResult[]
  success: boolean
}

// ── Sync Types ──────────────────────────────────────────────────

export interface SyncResult {
  itemId: string
  synced: boolean
  reason?: 'anchor-mismatch' | 'no-change' | 'file-not-found' | 'error'
  error?: string
}

export interface SyncSettings {
  enabled: boolean
  intervalMs: number
}

// ── App State (electron-store schema) ────────────────────────────

export interface AppState {
  profiles: Profile[]
  activeProfileId: string | null
  syncSettings: SyncSettings
}

// ── IPC Contract ─────────────────────────────────────────────────

export interface IpcResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

export interface CreateProfileReq {
  name: string
  presetId?: string
  items?: ConfigItem[]
}

export const IPC_CHANNELS = {
  PROFILE_LIST: 'profile:list',
  PROFILE_GET: 'profile:get',
  PROFILE_CREATE: 'profile:create',
  PROFILE_UPDATE: 'profile:update',
  PROFILE_DELETE: 'profile:delete',
  PROFILE_GET_ACTIVE: 'profile:get-active',
  PRESET_LIST: 'preset:list',
  PRESET_GET_ITEMS: 'preset:get-items',
  CONFIG_SWITCH: 'config:switch',
  CONFIG_IMPORT_CURRENT: 'config:import-current',
  IMPORT_AUTO_DETECT: 'import:auto-detect',
  IMPORT_PREVIEW: 'import:preview',
  SYNC_PROFILE: 'sync:profile',
  SYNC_GET_SETTINGS: 'sync:get-settings',
  SYNC_SET_SETTINGS: 'sync:set-settings'
} as const
