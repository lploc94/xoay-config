# Architecture Overview

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | Electron | 39.x |
| Build tool | electron-vite | 5.x |
| Frontend | Svelte 5 (runes mode) | 5.x |
| UI kit | Skeleton UI (Svelte) | 4.x |
| CSS | Tailwind CSS | 4.x |
| Storage | electron-store | 11.x |
| Bundler | Vite | 7.x |

## Process Model

Electron apps run three processes:

```
┌──────────────────────────────────────────────┐
│                  Main Process                 │
│  (Node.js — full system access)              │
│                                              │
│  ┌─────────┐ ┌─────────┐ ┌───────────────┐  │
│  │ storage  │ │  ipc    │ │ switch-engine │  │
│  │ .ts      │ │ .ts     │ │ .ts           │  │
│  └─────────┘ └─────────┘ └───────────────┘  │
│  ┌─────────┐ ┌─────────┐ ┌───────────────┐  │
│  │ presets  │ │  tray   │ │ import-service│  │
│  │ .ts      │ │ .ts     │ │ .ts           │  │
│  └─────────┘ └─────────┘ └───────────────┘  │
│  ┌───────────────┐ ┌──────────────────────┐  │
│  │ anchor-sync   │ │ preset-loader.ts     │  │
│  │ .ts           │ │ migration.ts         │  │
│  └───────────────┘ └──────────────────────┘  │
└──────────────────┬───────────────────────────┘
                   │ IPC (ipcMain.handle / ipcRenderer.invoke)
┌──────────────────┴───────────────────────────┐
│              Preload Process                  │
│  (Bridge — exposes electron API safely)       │
│  src/preload/index.ts                         │
└──────────────────┬───────────────────────────┘
                   │ contextBridge
┌──────────────────┴───────────────────────────┐
│            Renderer Process                   │
│  (Svelte 5 — sandboxed browser context)       │
│                                              │
│  App.svelte → lib/ipc.ts → window.electron   │
│             → lib/Sidebar.svelte              │
│             → lib/ProfileDetail.svelte        │
│             → lib/ConfigItemForm.svelte       │
│             → lib/CreateProfileDialog.svelte  │
│             → lib/SwitchResultDialog.svelte   │
└──────────────────────────────────────────────┘
```

### Main Process (`src/main/`)

The main process has full Node.js and system access. It manages:

- **Storage** (`storage.ts`) — Profile CRUD operations via `electron-store`. Data is persisted to `~/.config/xoay-config/xoay-config.json` (the default electron-store location with store name `xoay-config`).
- **IPC handlers** (`ipc.ts`, `switch-handlers.ts`) — Handle requests from the renderer via `ipcMain.handle()`.
- **Switch engine** (`switch-engine.ts`) — Executes config switches: file replacements, env var updates, shell commands. Manages backup and rollback.
- **Presets** (`presets.ts`, `preset-loader.ts`) — Loads preset templates from `.xoay-preset.json` files (built-in from `resources/presets/` and user-installed from `<userData>/presets/`). Handles import/export of portable preset files with embedded hook scripts. See [Presets](presets.md).
- **Migration** (`migration.ts`) — Runs schema migrations at startup (v1 → v2: adds categories, converts `activeProfileId` to per-category `activeProfileIds`).
- **Import service** (`import-service.ts`) — Reads current config files from disk to create a profile from existing settings.
- **Anchor sync** (`anchor-sync.ts`) — Syncs stored profile items with disk content using anchors. Provides manual sync (`syncProfile`) and automatic sync-on-switch (syncs the active profile before switching to a new one).
- **System tray** (`tray.ts`) — macOS menu bar tray icon with quick profile switching.

### Preload Process (`src/preload/`)

The preload script runs in a special context between main and renderer. It exposes the Electron IPC API to the renderer via `contextBridge`:

```ts
contextBridge.exposeInMainWorld('electron', electronAPI)
```

This gives the renderer access to `window.electron.ipcRenderer.invoke()` for making IPC calls, without exposing the full Node.js API.

### Renderer Process (`src/renderer/`)

The renderer is a Svelte 5 app using runes mode (`$state`, `$derived`). It communicates with the main process exclusively through IPC calls via the preload bridge.

Key components:
- `App.svelte` — Root component, manages global state and orchestrates all actions.
- `lib/ipc.ts` — Typed wrapper functions around `window.electron.ipcRenderer.invoke()`. Strips Svelte 5 reactive proxies before sending data over IPC (via `JSON.parse(JSON.stringify(...))`).

## Data Flow

A typical user action follows this path:

```
User clicks "Switch" button
  → App.svelte calls ipc.switchConfig(profileId)
    → lib/ipc.ts invokes IPC channel 'config:switch' via window.electron.ipcRenderer.invoke()
      → Preload bridge forwards to main process
        → switch-handlers.ts receives the call
          → Looks up profile from storage
          → Calls switchEngine.switch(profile)
            → Creates backup of target files
            → Executes file-replace items (atomic write)
            → Executes env-var items (regex find/replace in shell config)
            → Executes run-command items (spawn child process)
          → Updates activeProfileId in store
          → Rebuilds tray menu
        → Returns IpcResponse<SwitchResult>
      → Preload bridge forwards response to renderer
    → lib/ipc.ts unwraps response, throws on error
  → App.svelte shows SwitchResultDialog with results
```

## Build Configuration

The build is managed by `electron-vite` with three separate build targets configured in `electron.vite.config.ts`:

- **main** — Bundles `src/main/` with `externalizeDepsPlugin` (excludes `electron-store` from externalization since it needs bundling).
- **preload** — Bundles `src/preload/` with `externalizeDepsPlugin`.
- **renderer** — Bundles `src/renderer/` with Tailwind CSS and Svelte plugins.

## Storage Schema (v2)

Application state is stored by `electron-store` with this schema:

```ts
interface AppState {
  schemaVersion: number                      // Current schema version (2)
  categories: Category[]                     // Tool categories (e.g., "Claude Code", "Codex CLI")
  profiles: Profile[]                        // All user profiles
  activeProfileIds: Record<string, string>   // categoryId → profileId (one active per category)
  hookDisplayData: Record<string, Record<string, HookDisplayValue>>
}
```

**Categories** group profiles by tool. Built-in categories (`Claude Code`, `Codex CLI`) are created during migration. Custom categories are created automatically when importing a preset with a new `categoryName`.

```ts
interface Category {
  id: string
  name: string
  icon?: string       // Optional lucide icon name
  builtIn: boolean    // true for built-in categories
  createdAt: string
  updatedAt: string
}
```

**Active profiles** are tracked per-category via `activeProfileIds`. Each category can have one active profile independently. This replaced the singular `activeProfileId` from v1.

The store file is located at the default electron-store path with store name `xoay-config`.
