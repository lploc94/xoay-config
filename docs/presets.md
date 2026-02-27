# Presets

Presets are templates that pre-fill config items when creating a new profile. They define what files and env vars a tool (like Claude Code or Codex CLI) typically uses.

## Existing Presets

### Claude Code

**ID:** `claude-code`

Pre-fills three items:
| Item | Type | Target |
|------|------|--------|
| Claude settings.json | `file-replace` | `~/.claude/settings.json` |
| ANTHROPIC_BASE_URL | `env-var` | `~/.zshrc` |
| ANTHROPIC_AUTH_TOKEN | `env-var` | `~/.zshrc` |

### Codex CLI

**ID:** `codex-cli`

Pre-fills two items:
| Item | Type | Target |
|------|------|--------|
| Codex config.toml | `file-replace` | `~/.codex/config.toml` |
| Codex auth.json | `file-replace` | `~/.codex/auth.json` |

## Preset Interface

Defined in `src/shared/types.ts`:

```ts
interface Preset {
  id: string               // Unique identifier (e.g., "claude-code")
  name: string             // Display name (e.g., "Claude Code")
  description: string      // Short description shown in UI
  defaultItems: ConfigItem[]  // Template items to copy into new profiles
}
```

When a profile is created with a `presetId`:
- The preset's `defaultItems` are deep-cloned
- Each item gets a new UUID
- The items are added to the profile
- The `content` / `value` fields are initially empty (user fills them in, or uses "Import Current" to read from disk)

## How Presets Are Used

1. **New profile from preset:** User creates a profile and selects a preset. The preset's items are copied into the profile with empty values.
2. **Import current config:** User creates a profile via "Import Current" and optionally selects a preset. The import service reads the actual files from disk and fills in real values.
3. **Auto-detect:** The import service checks which presets have files on disk (e.g., `~/.claude/settings.json` exists → Claude Code is detected).

## Adding a New Preset

Edit `src/main/presets.ts` and add an entry to the `PRESETS` array:

```ts
export const PRESETS: Preset[] = [
  // ... existing presets ...
  {
    id: 'my-tool',
    name: 'My Tool',
    description: 'Config items for My Tool',
    defaultItems: [
      {
        id: 'my-tool-config',
        type: 'file-replace',
        label: 'My Tool config',
        enabled: true,
        targetPath: '~/.my-tool/config.json',
        content: ''
      },
      {
        id: 'my-tool-api-key',
        type: 'env-var',
        label: 'MY_TOOL_API_KEY',
        enabled: true,
        name: 'MY_TOOL_API_KEY',
        value: '',
        shellFile: '~/.zshrc'
      }
    ]
  }
]
```

**Guidelines:**

- The `id` field in each `defaultItems` entry is a placeholder — it gets replaced with a real UUID when a profile is created from this preset.
- Set `content` and `value` to empty strings. Users will fill them in or use "Import Current" to read existing values from disk.
- Set `enabled: true` for items that should be active by default.
- Use `~` for home directory paths — the switch engine resolves these at runtime.
- The `description` is shown in the "Create Profile" dialog to help users choose a preset.

## Preset Lookup

```ts
// src/main/presets.ts
export function getPresetById(id: string): Preset | undefined {
  return PRESETS.find((p) => p.id === id)
}
```

This is used by `storage.ts` when creating profiles and by `ipc.ts` when handling `preset:get-items`.
