# Xoay Config — Technical Documentation

Xoay Config is a macOS desktop app for managing and switching between multiple account/profile configurations for CLI tools like Claude Code and Codex CLI.

It lets you define **profiles** — each containing a set of config items (file replacements, environment variables, shell commands) — and switch between them with a single click from the app window or the system tray.

## Documentation Index

| Document | Description |
|----------|-------------|
| [Architecture](./architecture.md) | Project structure, tech stack, process model, data flow |
| [Getting Started](./getting-started.md) | Prerequisites, setup, dev workflow, production build |
| [Config Items](./config-items.md) | The three config item types, type definitions, execution order |
| [IPC API Reference](./ipc-api.md) | All IPC channels, request/response formats, error contract |
| [Switch Engine](./switch-engine.md) | Execution flow, backup, rollback, concurrency, atomic writes |
| [Presets](./presets.md) | Built-in presets, Preset interface, adding new presets |

## Key Concepts

- **Profile** — A named collection of config items. One profile can be "active" at a time.
- **Config Item** — A single configuration action: replace a file, set an env var, or run a command.
- **Preset** — A template that pre-fills config items when creating a new profile (e.g., Claude Code, Codex CLI).
- **Switch** — The process of applying all enabled config items in a profile to the system.

## Source Layout

```
src/
  shared/types.ts         # Shared type definitions (Profile, ConfigItem, IPC contracts)
  main/
    index.ts              # Electron main process entry point
    storage.ts            # Profile CRUD via electron-store
    switch-engine.ts      # Switch execution, backup, rollback
    switch-handlers.ts    # IPC handler for config:switch
    ipc.ts                # IPC handlers for profile/preset/import operations
    presets.ts            # Built-in preset definitions
    import-service.ts     # Import current config from disk
    tray.ts               # System tray menu
  preload/
    index.ts              # Preload bridge (exposes electron API to renderer)
  renderer/
    src/
      App.svelte          # Root Svelte component
      lib/
        ipc.ts            # Renderer-side IPC wrapper functions
        Sidebar.svelte    # Profile list sidebar
        ProfileDetail.svelte    # Profile detail view
        ConfigItemForm.svelte   # Config item add/edit dialog
        CreateProfileDialog.svelte  # New profile creation dialog
        SwitchResultDialog.svelte   # Switch result feedback dialog
```
