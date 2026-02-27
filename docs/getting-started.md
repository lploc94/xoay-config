# Getting Started

## Prerequisites

- **Node.js** >= 18
- **macOS** (primary target platform; Linux/Windows builds available but untested)
- **npm** (comes with Node.js)

## Setup

```bash
# Clone the repository
git clone <repo-url>
cd xoay-config

# Install dependencies
npm install
```

The `postinstall` script automatically runs `electron-builder install-app-deps` to set up native Electron dependencies.

## Development

```bash
# Start dev server with hot-reload
npm run dev
```

This runs `electron-vite dev`, which:
1. Starts Vite dev servers for main, preload, and renderer
2. Launches the Electron app
3. Enables HMR for the renderer process
4. Opens DevTools in development (toggle with F12)

## Available Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `dev` | `electron-vite dev` | Start development with hot-reload |
| `start` | `electron-vite preview` | Preview the production build |
| `build` | `npm run typecheck && electron-vite build` | Typecheck + build all processes |
| `build:mac` | `npm run build && electron-builder --mac` | Build macOS distributable |
| `build:win` | `npm run build && electron-builder --win` | Build Windows distributable |
| `build:linux` | `npm run build && electron-builder --linux` | Build Linux distributable |
| `build:unpack` | `npm run build && electron-builder --dir` | Build without packaging (for testing) |
| `typecheck` | `npm run typecheck:node && npm run svelte-check` | Run both TypeScript and Svelte type checks |
| `typecheck:node` | `tsc --noEmit -p tsconfig.node.json --composite false` | Typecheck main/preload (Node.js) code |
| `svelte-check` | `svelte-check --tsconfig ./tsconfig.json` | Typecheck Svelte components |
| `lint` | `eslint --cache .` | Run ESLint |
| `format` | `prettier --plugin prettier-plugin-svelte --write .` | Format code with Prettier |

## Production Build

```bash
# Build for macOS
npm run build:mac
```

This runs typecheck first, then bundles all three processes (main, preload, renderer) via `electron-vite build`, and finally packages the app with `electron-builder`.

The output goes to the `dist/` directory.

## Project Structure

```
xoay-config/
├── docs/                    # This documentation
├── resources/               # App icons, tray icons
│   ├── icon.png
│   ├── trayTemplate.png     # macOS tray icon (template image)
│   └── trayTemplate@2x.png  # 2x retina tray icon
├── src/
│   ├── shared/              # Shared types (used by main + renderer)
│   │   └── types.ts
│   ├── main/                # Electron main process
│   │   ├── index.ts         # Entry point (app init, window, tray)
│   │   ├── storage.ts       # Profile CRUD (electron-store)
│   │   ├── switch-engine.ts # Config switch execution
│   │   ├── switch-handlers.ts # IPC handler for config:switch
│   │   ├── ipc.ts           # IPC handlers (profile, preset, import)
│   │   ├── presets.ts       # Built-in preset definitions
│   │   ├── import-service.ts # Import config from disk
│   │   ├── tray.ts          # System tray
│   │   └── types.ts         # Re-exports from shared/types.ts
│   ├── preload/
│   │   ├── index.ts         # Preload bridge
│   │   └── index.d.ts       # Type declarations
│   └── renderer/
│       ├── index.html       # HTML entry point
│       └── src/
│           ├── main.ts      # Svelte app bootstrap
│           ├── App.svelte   # Root component
│           ├── env.d.ts     # Environment type declarations
│           ├── assets/
│           │   └── main.css # Global styles (Tailwind import)
│           └── lib/
│               ├── ipc.ts              # IPC wrapper functions
│               ├── Sidebar.svelte      # Profile list
│               ├── ProfileDetail.svelte # Profile editor
│               ├── ConfigItemForm.svelte # Item add/edit form
│               ├── CreateProfileDialog.svelte # New profile dialog
│               └── SwitchResultDialog.svelte  # Switch feedback
├── electron.vite.config.ts  # Build configuration
├── package.json
├── tsconfig.json            # Renderer TypeScript config
└── tsconfig.node.json       # Main/preload TypeScript config
```
