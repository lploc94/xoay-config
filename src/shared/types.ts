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

// ── Hook Types ──────────────────────────────────────────────────

export interface ProfileHook {
  id: string
  label: string
  enabled: boolean
  type: 'pre-switch-in' | 'post-switch-in' | 'pre-switch-out' | 'post-switch-out' | 'cron'
  scriptPath: string // path to .js file: "builtin/x.js" (built-in), "x.js" (user hook in <userData>/hooks/), or absolute path
  cronIntervalMs?: number // only for type 'cron', default 60000 (1 min), minimum 10000 (10s)
  timeout?: number // ms, default 30000
}

export interface HookDisplayValue {
  value: string | null // null = clear this field
  label?: string // display label, e.g. "API Quota"
  status?: 'ok' | 'warning' | 'error' // color coding
}

export interface HookActions {
  switchToNextProfile?: boolean // switch to next profile in list (circular)
  switchToProfile?: string // switch to specific profile by ID (overrides switchToNextProfile)
  notify?: string // show inline notification with custom message
}

export interface HookOutput {
  display?: Record<string, HookDisplayValue>
  actions?: HookActions
}

export interface HookContext {
  profileId: string
  profileName: string
  hookType: string
  profile: Profile
}

export interface HookResult {
  hookId: string
  hookLabel: string
  success: boolean
  error?: string
  stdout?: string
  stderr?: string
  display?: Record<string, HookDisplayValue> // parsed from stdout if valid JSON
  actions?: HookActions // parsed from stdout if valid JSON
}

// ── Built-in Hook Info ──────────────────────────────────────────

export interface BuiltinHookInfo {
  name: string
  filename: string
  description: string
}

// ── Profile ──────────────────────────────────────────────────────

export interface Profile {
  id: string
  name: string
  presetId?: string
  items: ConfigItem[]
  hooks: ProfileHook[]
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
  hookResults?: HookResult[]
  success: boolean
}

// ── Sync Types ──────────────────────────────────────────────────

export interface SyncResult {
  itemId: string
  synced: boolean
  reason?: 'anchor-mismatch' | 'no-change' | 'file-not-found' | 'error'
  error?: string
}

// ── App State (electron-store schema) ────────────────────────────

export interface AppState {
  profiles: Profile[]
  activeProfileId: string | null
  hookDisplayData: Record<string, Record<string, HookDisplayValue>>
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
  HOOK_ADD: 'hook:add',
  HOOK_UPDATE: 'hook:update',
  HOOK_DELETE: 'hook:delete',
  HOOK_SELECT_FILE: 'hook:select-file',
  HOOK_GET_DISPLAY_DATA: 'hook:get-display-data',
  HOOK_LIST_BUILTIN: 'hook:list-builtin'
} as const
