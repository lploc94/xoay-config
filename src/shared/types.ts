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
}

export interface EnvVarItem extends BaseConfigItem {
  type: 'env-var'
  name: string
  value: string
  shellFile: string
}

export interface RunCommandItem extends BaseConfigItem {
  type: 'run-command'
  command: string
  workingDir?: string
  timeout?: number
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
  runInBackground?: boolean // only for type 'cron': true = runs for all profiles regardless of active state
  builtIn?: boolean // true for hooks auto-attached by the app; can be disabled but not deleted
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

export interface DisplayItem {
  type: 'text' | 'number' | 'percentage' | 'status' | 'key-value' | 'html'
  label: string
  value: string | number | null
  max?: number              // percentage: max value (default 100)
  status?: 'ok' | 'warning' | 'error'
  entries?: Record<string, string>  // key-value type
  span?: 1 | 2 | 3 | 'full'
}

export interface ConfigUpdate {
  itemId: string
  content?: string  // for file-replace items
  value?: string    // for env-var items
}

export interface HookOutput {
  display?: DisplayItem[]
  actions?: HookActions
  configUpdates?: ConfigUpdate[]
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
  display?: DisplayItem[] // parsed from stdout if valid JSON
  actions?: HookActions // parsed from stdout if valid JSON
  configUpdates?: ConfigUpdate[] // parsed from stdout if valid JSON
}

// ── Built-in Hook Info ──────────────────────────────────────────

export interface BuiltinHookInfo {
  name: string
  filename: string
  description: string
}

// ── Category ─────────────────────────────────────────────────────

export interface Category {
  id: string
  name: string
  icon?: string // optional icon name from lucide
  builtIn: boolean // true for "Claude Code", "Codex CLI"
  createdAt: string
  updatedAt: string
}

// ── Profile ──────────────────────────────────────────────────────

export interface Profile {
  id: string
  name: string
  categoryId: string
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
  categoryName?: string
  defaultItems: ConfigItem[]
  hooks?: PresetHookDef[]
}

// ── Preset File Format (.xoay-preset.json) ───────────────────────

export interface PresetDefaultItem {
  type: 'file-replace' | 'env-var' | 'run-command'
  label: string
  enabled: boolean
  targetPath?: string   // file-replace
  name?: string         // env-var
  value?: string        // env-var
  shellFile?: string    // env-var
  command?: string      // run-command (legacy)
  workingDir?: string   // run-command (legacy)
  timeout?: number      // run-command (legacy)
}

export interface PresetHookDef {
  label: string
  type: 'pre-switch-in' | 'post-switch-in' | 'pre-switch-out' | 'post-switch-out' | 'cron'
  cronIntervalMs?: number
  timeout?: number
  scriptFile: string // key into scripts object
}

export interface PresetFile {
  $schema: string
  id: string
  name: string
  description: string
  categoryName: string
  defaultItems: PresetDefaultItem[]
  hooks?: PresetHookDef[]
  scripts?: Record<string, string> // filename → base64 encoded content
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

// ── App State (electron-store schema) ────────────────────────────

export interface AppState {
  schemaVersion: number
  categories: Category[]
  profiles: Profile[]
  activeProfileIds: Record<string, string> // categoryId → profileId
  hookDisplayData: Record<string, DisplayItem[]>
  hookDisplayTimestamps: Record<string, number> // profileId → last hook-run epoch ms
}

// ── IPC Contract ─────────────────────────────────────────────────

export interface IpcResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

export interface CreateProfileReq {
  name: string
  categoryId: string
  presetId?: string
  items?: ConfigItem[]
}

export const IPC_CHANNELS = {
  CATEGORY_LIST: 'category:list',
  CATEGORY_CREATE: 'category:create',
  CATEGORY_UPDATE: 'category:update',
  CATEGORY_DELETE: 'category:delete',
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
  HOOK_ADD: 'hook:add',
  HOOK_UPDATE: 'hook:update',
  HOOK_DELETE: 'hook:delete',
  HOOK_SELECT_FILE: 'hook:select-file',
  HOOK_GET_DISPLAY_DATA: 'hook:get-display-data',
  HOOK_LIST_BUILTIN: 'hook:list-builtin',
  HOOK_GET_DISPLAY_TIMESTAMPS: 'hook:get-display-timestamps',
  PRESET_IMPORT: 'preset:import',
  PRESET_EXPORT: 'preset:export'
} as const
