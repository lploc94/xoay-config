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
}
```

---

### `profile:list`

List all profiles.

- **Request:** no arguments
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

Get the currently active profile ID.

- **Request:** no arguments
- **Response:** `IpcResponse<string | null>`
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
  ```
- **Handler:** `src/main/switch-handlers.ts`
- **Notes:** On success, updates `activeProfileId` in the store and rebuilds the tray menu. On failure, the switch engine automatically rolls back file-replace and env-var changes. See [Switch Engine](./switch-engine.md).

### `config:import-current`

Import the current config from disk and create a new profile.

- **Request:** `{ name: string, presetId?: string }`
- **Response:** `IpcResponse<Profile>`
- **Handler:** `src/main/ipc.ts`
- **Notes:** Reads actual files from disk based on the preset's target paths. If no `presetId` is given, auto-detects which presets are relevant. Also scans `~/.zshrc` for additional `ANTHROPIC_*` and `OPENAI_*` env vars. Returns an error if no config files are found.

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

## Events (Main → Renderer)

In addition to the request-response pattern, the main process can push events to the renderer via `webContents.send()`:

### `profile:switched`

Sent when a profile is switched from the system tray (not from the renderer).

- **Payload:** `SwitchResult`
- **Source:** `src/main/tray.ts` — `switchFromTray()`
- **Listener:** The renderer subscribes via `window.electron.ipcRenderer.on('profile:switched', handler)` in `src/renderer/src/lib/ipc.ts`.
