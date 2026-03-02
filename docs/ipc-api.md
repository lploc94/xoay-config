# IPC API Reference

All communication between the renderer and main process uses Electron's IPC (Inter-Process Communication) via `ipcMain.handle()` / `ipcRenderer.invoke()` (request-response pattern).

## Error Contract

Every IPC handler returns an `IpcResponse<T>`:

```ts
interface IpcResponse<T = unknown> {
  success: boolean
  data?: T       // Present when success is true
  error?: string // Present when success is false
}
```

The renderer-side wrapper (`src/renderer/src/lib/ipc.ts`) automatically unwraps this:
- On success: returns `data` as `T`
- On failure: throws `Error(error)`

## Preload Bridge

The preload script (`src/preload/index.ts`) exposes the Electron API to the renderer:

```ts
contextBridge.exposeInMainWorld('electron', electronAPI)
```

The renderer accesses IPC via `window.electron.ipcRenderer.invoke(channel, ...args)`.

**Important:** The renderer IPC wrapper strips Svelte 5 reactive proxies before sending data, because IPC uses structured clone which cannot handle Proxy objects:

```ts
const plainArgs = args.map(a => JSON.parse(JSON.stringify(a)))
```

## Channels

All channel names are defined in `src/shared/types.ts` as `IPC_CHANNELS`:

```ts
const IPC_CHANNELS = {
  CATEGORY_LIST:       'category:list',
  CATEGORY_CREATE:     'category:create',
  CATEGORY_UPDATE:     'category:update',
  CATEGORY_DELETE:     'category:delete',
  PROFILE_LIST:        'profile:list',
  PROFILE_GET:         'profile:get',
  PROFILE_CREATE:      'profile:create',
  PROFILE_UPDATE:      'profile:update',
  PROFILE_DELETE:      'profile:delete',
  PROFILE_GET_ACTIVE:  'profile:get-active',
  PRESET_LIST:         'preset:list',
  PRESET_GET_ITEMS:    'preset:get-items',
  CONFIG_SWITCH:       'config:switch',
  CONFIG_IMPORT_CURRENT: 'config:import-current',
  IMPORT_AUTO_DETECT:  'import:auto-detect',
  IMPORT_PREVIEW:      'import:preview',
  SYNC_PROFILE:        'sync:profile',
  HOOK_ADD:            'hook:add',
  HOOK_UPDATE:         'hook:update',
  HOOK_DELETE:         'hook:delete',
  HOOK_SELECT_FILE:    'hook:select-file',
  HOOK_GET_DISPLAY_DATA: 'hook:get-display-data',
  HOOK_LIST_BUILTIN:   'hook:list-builtin',
  HOOK_GET_DISPLAY_TIMESTAMPS: 'hook:get-display-timestamps',
  PRESET_IMPORT:       'preset:import',
  PRESET_EXPORT:       'preset:export',
}
```

---

### `category:list`

List all categories.

- **Request:** no arguments
- **Response:** `IpcResponse<Category[]>`
  ```ts
  interface Category {
    id: string
    name: string
    icon?: string      // optional icon name from lucide
    builtIn: boolean   // true for built-in categories
    createdAt: string
    updatedAt: string
  }
  ```
- **Handler:** `src/main/ipc.ts`

### `category:create`

Create a new category.

- **Request:** `{ name: string, icon?: string, builtIn?: boolean }`
- **Response:** `IpcResponse<Category>`
- **Handler:** `src/main/ipc.ts`

### `category:update`

Update an existing category (full replacement).

- **Request:** `Category` (the full category object)
- **Response:** `IpcResponse<Category>`
- **Handler:** `src/main/ipc.ts`

### `category:delete`

Delete a category by ID.

- **Request:** `{ id: string }`
- **Response:** `IpcResponse<void>`
- **Handler:** `src/main/ipc.ts`
- **Notes:** Deletes the category and cleans up associated data (profiles, active profile IDs).

---

### `profile:list`

List all profiles, optionally filtered by category.

- **Request:** `{ categoryId?: string }` (optional — omit or pass `undefined` for all profiles)
- **Response:** `IpcResponse<Profile[]>`
- **Handler:** `src/main/ipc.ts`

### `profile:get`

Get a single profile by ID.

- **Request:** `{ id: string }`
- **Response:** `IpcResponse<Profile | null>`
- **Handler:** `src/main/ipc.ts`

### `profile:create`

Create a new profile.

- **Request:** `CreateProfileReq`
  ```ts
  interface CreateProfileReq {
    name: string
    categoryId: string
    presetId?: string     // If set and items is empty, copies preset's defaultItems
    items?: ConfigItem[]  // Explicit items (takes priority over presetId)
  }
  ```
- **Response:** `IpcResponse<Profile>`
- **Handler:** `src/main/ipc.ts`
- **Notes:** When `presetId` is provided and `items` is empty/omitted, the handler deep-clones the preset's default items and assigns new UUIDs. When `items` are provided, they are used as-is regardless of `presetId`.

### `profile:update`

Update an existing profile (full replacement).

- **Request:** `Profile` (the full profile object with all fields)
- **Response:** `IpcResponse<Profile>`
- **Handler:** `src/main/ipc.ts`
- **Notes:** Automatically sets `updatedAt` to the current timestamp. Throws if the profile ID is not found.

### `profile:delete`

Delete a profile by ID.

- **Request:** `{ id: string }`
- **Response:** `IpcResponse<void>`
- **Handler:** `src/main/ipc.ts`
- **Notes:** If the deleted profile is the active profile, `activeProfileId` is cleared to `null`.

### `profile:get-active`

Get the active profile IDs for all categories.

- **Request:** no arguments
- **Response:** `IpcResponse<Record<string, string>>` (map of `categoryId` → `profileId`)
- **Handler:** `src/main/ipc.ts`

---

### `preset:list`

List all available presets.

- **Request:** no arguments
- **Response:** `IpcResponse<Preset[]>`
- **Handler:** `src/main/ipc.ts`

### `preset:get-items`

Get the default config items for a preset.

- **Request:** `{ presetId: string }`
- **Response:** `IpcResponse<ConfigItem[]>`
- **Handler:** `src/main/ipc.ts`
- **Notes:** Returns an error if the preset ID is not found.

---

### `config:switch`

Switch to a profile — executes all enabled config items.

- **Request:** `{ profileId: string }`
- **Response:** `IpcResponse<SwitchResult>`
  ```ts
  interface SwitchResult {
    profileId: string
    backupId: string
    results: ItemResult[]
    hookResults?: HookResult[]
    success: boolean
  }

  interface ItemResult {
    itemId: string
    type?: ConfigItem['type']
    label?: string
    success: boolean
    error?: string
    stdout?: string   // For run-command items
    stderr?: string   // For run-command items
  }

  interface HookResult {
    hookId: string
    hookLabel: string
    success: boolean
    error?: string
    stdout?: string
    stderr?: string
    display?: Record<string, HookDisplayValue>
    actions?: HookActions
  }
  ```
- **Handler:** `src/main/switch-handlers.ts`
- **Notes:** On success, updates `activeProfileId` in the store and rebuilds the tray menu. On failure, the switch engine automatically rolls back file-replace and env-var changes. See [Switch Engine](./switch-engine.md).

### `config:import-current`

Import the current config from disk and create a new profile.

- **Request:** `{ name: string, categoryId: string, presetId?: string }`
- **Response:** `IpcResponse<Profile>`
- **Handler:** `src/main/ipc.ts`
- **Notes:** Reads actual files from disk based on the preset's target paths. If no `presetId` is given, auto-detects which presets are relevant. Returns an error if no config files are found.

### `import:auto-detect`

Auto-detect which presets have config files on disk.

- **Request:** no arguments
- **Response:** `IpcResponse<string[]>` (array of preset IDs)
- **Handler:** `src/main/ipc.ts`
- **Notes:** Checks if any `file-replace` target files from each preset exist on disk.

### `import:preview`

Preview what config items would be imported from disk.

- **Request:** `{ presetId?: string }`
- **Response:** `IpcResponse<ConfigItem[]>`
- **Handler:** `src/main/ipc.ts`
- **Notes:** Same logic as `config:import-current` but returns items without creating a profile.

---

### `sync:profile`

Manually sync a profile's anchored items with disk content. Reads files from disk and updates stored item values when the anchor matches and content has changed.

- **Request:** `{ profileId: string }`
- **Response:** `IpcResponse<{ results: SyncResult[] }>`
  ```ts
  interface SyncResult {
    itemId: string
    synced: boolean
    reason?: 'anchor-mismatch' | 'no-change' | 'file-not-found' | 'error'
    error?: string
  }
  ```
- **Handler:** `src/main/ipc.ts` → delegates to `anchor-sync.ts`
- **Notes:** Only processes `file-replace` and `env-var` items that have an `anchor` configured. Items without anchors are skipped. When `synced: true`, the stored content/value has been updated from disk. When `synced: false`, `reason` explains why (anchor didn't match, file unchanged, etc.).

---

### `hook:add`

Add a hook to a profile.

- **Request:** `{ profileId: string, hook: ProfileHook }`
  ```ts
  interface ProfileHook {
    id: string
    label: string
    enabled: boolean
    type: 'pre-switch-in' | 'post-switch-in' | 'pre-switch-out' | 'post-switch-out' | 'cron'
    scriptPath: string       // "builtin/x.js", "x.js" (user hook), or absolute path
    cronIntervalMs?: number  // cron only, default 60000, minimum 10000
    timeout?: number         // ms, default 30000
  }
  ```
- **Response:** `IpcResponse<Profile>` (the updated profile)
- **Handler:** `src/main/ipc.ts`
- **Notes:** Appends the hook to the profile's `hooks` array. Returns error if the profile is not found.

### `hook:update`

Update an existing hook on a profile.

- **Request:** `{ profileId: string, hook: ProfileHook }`
- **Response:** `IpcResponse<Profile>` (the updated profile)
- **Handler:** `src/main/ipc.ts`
- **Notes:** Replaces the hook with the matching `hook.id`. Returns error if the profile or hook is not found.

### `hook:delete`

Delete a hook from a profile.

- **Request:** `{ profileId: string, hookId: string }`
- **Response:** `IpcResponse<Profile>` (the updated profile)
- **Handler:** `src/main/ipc.ts`
- **Notes:** Removes the hook with the matching ID from the profile's `hooks` array.

### `hook:select-file`

Open a native file picker dialog to select a hook script.

- **Request:** no arguments
- **Response:** `IpcResponse<string | null>` (relative or absolute path, or `null` if canceled)
- **Handler:** `src/main/ipc.ts`
- **Notes:** Opens a dialog defaulting to the user hooks directory (`<userData>/hooks/`). Returns a relative path if the selected file is inside the hooks directory, otherwise an absolute path.

### `hook:get-display-data`

Get all persisted hook display data for all profiles.

- **Request:** no arguments
- **Response:** `IpcResponse<Record<string, Record<string, HookDisplayValue>>>`
  ```ts
  // Outer key: profileId, inner key: display field name
  interface HookDisplayValue {
    value: string | null
    label?: string
    status?: 'ok' | 'warning' | 'error'
  }
  ```
- **Handler:** `src/main/ipc.ts`
- **Notes:** Reads from `electron-store` key `hookDisplayData`. Returns an empty object if no data exists.

### `hook:list-builtin`

List all available built-in hook scripts.

- **Request:** no arguments
- **Response:** `IpcResponse<BuiltinHookInfo[]>`
  ```ts
  interface BuiltinHookInfo {
    name: string
    filename: string
    description: string
  }
  ```
- **Handler:** `src/main/ipc.ts`

### `hook:get-display-timestamps`

Get the last hook display update timestamp for each profile.

- **Request:** no arguments
- **Response:** `IpcResponse<Record<string, number>>` (map of `profileId` → epoch milliseconds)
- **Handler:** `src/main/ipc.ts`
- **Notes:** Reads from `electron-store` key `hookDisplayTimestamps`. Only updated when a hook produces display data.

---

### `preset:import`

Open a file picker and import a `.xoay-preset.json` file.

- **Request:** no arguments
- **Response:** `IpcResponse<{ preset: Preset, category: Category } | null>` (`null` if dialog was canceled)
- **Handler:** `src/main/ipc.ts`
- **Notes:** Parses the preset file, registers the preset, and creates or finds the matching category. Returns both the imported preset and the associated category.

### `preset:export`

Export a preset to a `.xoay-preset.json` file.

- **Request:** `{ presetId: string }`
- **Response:** `IpcResponse<boolean>` (`true` if saved, `false` if dialog was canceled)
- **Handler:** `src/main/ipc.ts`
- **Notes:** Opens a save dialog. Collects hooks from profiles using this preset and includes them in the export. Returns error if the preset is not found.

---

## Events (Main → Renderer)

In addition to the request-response pattern, the main process can push events to the renderer via `webContents.send()`:

### `profile:switched`

Sent when a profile is switched from the system tray (not from the renderer).

- **Payload:** `SwitchResult`
- **Source:** `src/main/tray.ts` — `switchFromTray()`
- **Listener:** The renderer subscribes via `window.electron.ipcRenderer.on('profile:switched', handler)` in `src/renderer/src/lib/ipc.ts`.

### `hook:display-update`

Sent when a hook produces new display data and it has been merged into the store.

- **Payload:**
  ```ts
  {
    profileId: string
    displayData: Record<string, HookDisplayValue>  // merged display data for this profile
    updatedAt: number                               // epoch ms timestamp
  }
  ```
- **Source:** `src/main/hook-executor.ts` — `mergeDisplayData()`
- **Listener:** The renderer uses this event to update the Status Card and sidebar badges in real-time without polling.

### `hook:notify`

Sent when a hook's `actions.notify` field triggers an inline notification.

- **Payload:**
  ```ts
  {
    message: string     // the notification message
    hookLabel: string   // which hook triggered it
  }
  ```
- **Source:** `src/main/hook-executor.ts` — `processHookActions()`
- **Listener:** The renderer shows the notification as a banner in the profile detail view.
