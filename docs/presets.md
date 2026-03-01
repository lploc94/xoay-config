# Presets (v2 — File-Based)

Presets are portable templates that define config items and hooks for a tool (e.g., Claude Code, Codex CLI). They are stored as `.xoay-preset.json` files and can be imported/exported between machines.

> **Migration from v1:** In v1, presets were hardcoded in `src/main/presets.ts`. In v2, presets are JSON files loaded from disk. See [Migration from v1](#migration-from-v1) for details.

## File Format

Preset files use the `.xoay-preset.json` extension and follow this schema:

```json
{
  "$schema": "xoay-preset/v1",
  "id": "my-tool",
  "name": "My Tool",
  "description": "Config items for My Tool",
  "categoryName": "My Tool",
  "defaultItems": [ ... ],
  "hooks": [ ... ],
  "scripts": { ... }
}
```

### Top-Level Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `$schema` | `string` | ✅ | Must be `"xoay-preset/v1"`. Used for validation. |
| `id` | `string` | ✅ | Unique preset identifier (e.g., `"claude-code"`). |
| `name` | `string` | ✅ | Display name shown in the UI. |
| `description` | `string` | ✅ | Short description shown in the "Create Profile" dialog. |
| `categoryName` | `string` | ✅ | Name of the category to assign profiles to on import. The category is matched by name or created automatically if it doesn't exist. |
| `defaultItems` | `PresetDefaultItem[]` | ✅ | Template config items copied into new profiles. |
| `hooks` | `PresetHookDef[]` | ❌ | Hook definitions bundled with the preset. |
| `scripts` | `Record<string, string>` | ❌ | Hook script files embedded as base64-encoded strings. Keys are filenames, values are base64 content. |

### Default Items (`PresetDefaultItem`)

Each item in `defaultItems` defines a config item template. There are three types:

#### `file-replace`

Replaces a file on disk when switching profiles.

```json
{
  "type": "file-replace",
  "label": "Claude settings.json",
  "enabled": true,
  "targetPath": "~/.claude/settings.json"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"file-replace"` | ✅ | Item type. |
| `label` | `string` | ✅ | Display label in the UI. |
| `enabled` | `boolean` | ✅ | Whether the item is active by default. |
| `targetPath` | `string` | ✅ | Path to the file. Use `~` for the home directory. |

#### `env-var`

Sets an environment variable in a shell config file.

```json
{
  "type": "env-var",
  "label": "ANTHROPIC_AUTH_TOKEN",
  "enabled": true,
  "name": "ANTHROPIC_AUTH_TOKEN",
  "value": "",
  "shellFile": "~/.zshrc"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"env-var"` | ✅ | Item type. |
| `label` | `string` | ✅ | Display label. |
| `enabled` | `boolean` | ✅ | Active by default. |
| `name` | `string` | ✅ | Environment variable name. |
| `value` | `string` | ✅ | Default value (usually empty — user fills in). |
| `shellFile` | `string` | ✅ | Shell config file to modify (e.g., `~/.zshrc`). |

#### `run-command`

Executes a shell command during profile switch.

```json
{
  "type": "run-command",
  "label": "Restart service",
  "enabled": true,
  "command": "systemctl restart my-service",
  "workingDir": "~/projects",
  "timeout": 15000
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"run-command"` | ✅ | Item type. |
| `label` | `string` | ✅ | Display label. |
| `enabled` | `boolean` | ✅ | Active by default. |
| `command` | `string` | ✅ | Shell command to execute. |
| `workingDir` | `string` | ❌ | Working directory for the command. |
| `timeout` | `number` | ❌ | Timeout in milliseconds (default: 30000). |

### Hook Definitions (`PresetHookDef`)

Hooks run scripts at specific lifecycle events. When bundled in a preset, hooks reference scripts stored in the `scripts` object.

```json
{
  "hooks": [
    {
      "label": "Codex Quota Check",
      "type": "cron",
      "cronIntervalMs": 60000,
      "scriptFile": "codex-quota.js"
    }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `label` | `string` | ✅ | Display label for the hook. |
| `type` | `string` | ✅ | Hook lifecycle type (see below). |
| `cronIntervalMs` | `number` | ❌ | Interval in ms for `cron` hooks (default: 60000, minimum: 10000). |
| `timeout` | `number` | ❌ | Script execution timeout in ms (default: 30000). |
| `scriptFile` | `string` | ✅ | Filename of the script. Must be a key in the `scripts` object. |

**Hook types:**

| Type | When it runs |
|------|-------------|
| `pre-switch-in` | Before switching to this profile. |
| `post-switch-in` | After switching to this profile. |
| `pre-switch-out` | Before switching away from this profile. |
| `post-switch-out` | After switching away from this profile. |
| `cron` | Periodically while this profile is active. |

### Embedded Scripts (`scripts`)

Hook scripts are embedded as base64-encoded strings so presets are fully self-contained and portable.

```json
{
  "scripts": {
    "codex-quota.js": "Y29uc29sZS5sb2coJ2hlbGxvJyk7Cg=="
  }
}
```

The key is the filename (must match `scriptFile` in a hook definition), and the value is the file content encoded in base64.

## Directory Structure

Presets are loaded from two directories:

| Location | Description | Path |
|----------|-------------|------|
| **Built-in** | Shipped with the app | `resources/presets/` (in source) → `<resourcesPath>/resources/presets/` (in production) |
| **User** | Imported by the user | `<userData>/presets/` |

Platform-specific `<userData>` paths:
- **macOS:** `~/Library/Application Support/xoay-config/presets/`
- **Windows:** `%APPDATA%\xoay-config\presets\`
- **Linux:** `~/.config/xoay-config/presets/`

When presets share the same `id`, user presets override built-in presets. This allows customizing built-in presets without modifying the app.

## Built-in Presets

### Claude Code (`claude-code`)

**File:** `resources/presets/claude-code.xoay-preset.json`

| Item | Type | Target |
|------|------|--------|
| Claude settings.json | `file-replace` | `~/.claude/settings.json` |
| ANTHROPIC_BASE_URL | `env-var` | `~/.zshrc` |
| ANTHROPIC_AUTH_TOKEN | `env-var` | `~/.zshrc` |

### Codex CLI (`codex-cli`)

**File:** `resources/presets/codex-cli.xoay-preset.json`

| Item | Type | Target |
|------|------|--------|
| Codex config.toml | `file-replace` | `~/.codex/config.toml` |
| Codex auth.json | `file-replace` | `~/.codex/auth.json` |

**Hooks:**
| Hook | Type | Interval |
|------|------|----------|
| Codex Quota Check | `cron` | 60s |

The Codex Quota Check hook monitors API usage and can auto-switch profiles when quota exceeds 95%.

## Import Flow

When a user imports a `.xoay-preset.json` file (`preset:import` IPC channel):

1. **Parse** — Read and validate the JSON file (`readPresetFile`).
2. **Extract scripts** — Decode base64 scripts and write them to `<userData>/hooks/<presetId>/` directory.
3. **Copy preset** — Copy the `.xoay-preset.json` file to `<userData>/presets/`.
4. **Resolve category** — Find an existing category matching `categoryName`, or create a new one.
5. **Return** — Return the converted `Preset` object and the resolved `Category`.

Source: `src/main/preset-loader.ts` → `importPresetFile()`

## Export Flow

When a user exports a preset (`preset:export` IPC channel):

1. **Build preset file** — Convert the runtime `Preset` object back to `PresetFile` format.
2. **Map items** — Convert `ConfigItem[]` to `PresetDefaultItem[]` (strips runtime fields like `id` and `content`).
3. **Map hooks** — Convert `ProfileHook[]` to `PresetHookDef[]` (replaces full `scriptPath` with just the filename).
4. **Embed scripts** — Read each hook's script file from disk and encode it as base64 into the `scripts` object.
5. **Write** — Save the JSON file to the user-chosen path.

Source: `src/main/preset-loader.ts` → `exportPreset()`

## Creating a Custom Preset

To create a new preset, create a `.xoay-preset.json` file:

```json
{
  "$schema": "xoay-preset/v1",
  "id": "my-tool",
  "name": "My Tool",
  "description": "Config items for My Tool (API key + config file)",
  "categoryName": "My Tool",
  "defaultItems": [
    {
      "type": "file-replace",
      "label": "My Tool config",
      "enabled": true,
      "targetPath": "~/.my-tool/config.json"
    },
    {
      "type": "env-var",
      "label": "MY_TOOL_API_KEY",
      "enabled": true,
      "name": "MY_TOOL_API_KEY",
      "value": "",
      "shellFile": "~/.zshrc"
    }
  ]
}
```

**To install:**
- **Import via UI:** Use the import button to select the file. It will be copied to the user presets directory.
- **Manual install:** Place the file directly in `<userData>/presets/`.

**Guidelines:**
- Use a unique `id` that won't collide with built-in presets (unless you want to override one).
- Set `value` and `content`-like fields to empty strings — users fill them in when creating a profile, or use "Import Current" to read values from disk.
- Use `~` for home directory paths — the switch engine resolves them at runtime.
- The `categoryName` should be descriptive. If a category with that name exists, profiles will be grouped under it. Otherwise, a new category is created automatically.

### Adding Hooks to a Custom Preset

To bundle hook scripts with your preset:

1. Write your hook script (e.g., `my-check.js`).
2. Encode it in base64: `base64 < my-check.js`
3. Add the hook definition and script to your preset file:

```json
{
  "$schema": "xoay-preset/v1",
  "id": "my-tool",
  "name": "My Tool",
  "description": "My Tool with quota monitoring",
  "categoryName": "My Tool",
  "defaultItems": [ ... ],
  "hooks": [
    {
      "label": "Quota Check",
      "type": "cron",
      "cronIntervalMs": 120000,
      "scriptFile": "my-check.js"
    }
  ],
  "scripts": {
    "my-check.js": "<base64-encoded-script-content>"
  }
}
```

## Category Mapping

The `categoryName` field controls how profiles are organized in the sidebar:

- On **import**, the preset loader calls `findOrCreateCategory(categoryName)`.
- If a category with that exact name already exists, it is reused.
- If not, a new category is created with `builtIn: false`.
- Built-in categories (`Claude Code`, `Codex CLI`) are created during migration and have `builtIn: true`.

This means different presets can share the same category by using the same `categoryName`.

## Migration from v1

In v1, presets were hardcoded as a `PRESETS` array in `src/main/presets.ts`. The v2 system replaces this with file-based presets.

**What changed:**
- `src/main/presets.ts` now re-exports from `src/main/preset-loader.ts` for backward compatibility.
- Presets are loaded from `.xoay-preset.json` files in `resources/presets/` (built-in) and `<userData>/presets/` (user).
- The `Preset` interface gained `categoryName` and optional `hooks` fields.
- New types were added: `PresetFile`, `PresetDefaultItem`, `PresetHookDef`.

**Schema migration (v1 → v2):**
- The `migration.ts` module runs at startup (`runMigrations()`).
- It creates built-in categories (`Claude Code`, `Codex CLI`).
- Existing profiles get `categoryId` assigned based on their `presetId`.
- The singular `activeProfileId` is converted to a per-category `activeProfileIds` record.
- `schemaVersion` is set to `2`.

## Source Files

| File | Description |
|------|-------------|
| `src/main/preset-loader.ts` | Core preset loading, import, export logic. |
| `src/main/presets.ts` | Re-exports `getAllPresets` and `getPresetById` from `preset-loader.ts`. |
| `src/shared/types.ts` | Type definitions: `PresetFile`, `PresetDefaultItem`, `PresetHookDef`, `Preset`. |
| `src/main/paths.ts` | Directory paths including `PATHS.presets`. |
| `src/main/migration.ts` | v1 → v2 schema migration. |
| `resources/presets/*.xoay-preset.json` | Built-in preset files. |
