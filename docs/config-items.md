# Config Items

Config items are the building blocks of a profile. Each item represents a single configuration action that executes during a profile switch.

## Three Types

### 1. `file-replace`

Replaces the entire contents of a target file with the specified content.

```ts
interface FileReplaceItem extends BaseConfigItem {
  type: 'file-replace'
  targetPath: string      // Absolute path or ~ for home (e.g., "~/.claude/settings.json")
  content: string         // Full file content to write
  anchor?: AnchorConfig   // Optional anchor (json-path or line-content)
}
```

**Use case:** Swapping config files like `~/.claude/settings.json`, `~/.codex/config.toml`.

**Execution:** Atomic write via temp file + rename. See [Switch Engine](./switch-engine.md) for details.

### 2. `env-var`

Sets an environment variable in a shell config file (e.g., `~/.zshrc`).

```ts
interface EnvVarItem extends BaseConfigItem {
  type: 'env-var'
  name: string             // Variable name (e.g., "ANTHROPIC_BASE_URL")
  value: string            // Variable value
  shellFile: string        // Shell config file path (e.g., "~/.zshrc")
  anchor?: AnchorConfig    // Optional anchor (env-value only)
}
```

**Use case:** Switching API keys, base URLs, and other env vars between accounts.

**Execution:** Uses regex to find/replace `export NAME=...` lines in the shell file. See [Switch Engine](./switch-engine.md) for the regex strategy.

### 3. `run-command`

Executes a shell command.

```ts
interface RunCommandItem extends BaseConfigItem {
  type: 'run-command'
  command: string       // Shell command to execute
  workingDir?: string   // Working directory (defaults to $HOME)
  timeout?: number      // Timeout in ms (default: 30000)
}
```

**Use case:** Running setup scripts, restarting services, clearing caches after switching.

**Execution:** Spawns `sh -c <command>` as a child process with a timeout. See [Switch Engine](./switch-engine.md) for details.

## Base Interface

All config items share these common fields:

```ts
interface BaseConfigItem {
  id: string       // UUID, auto-generated
  label: string    // Human-readable label shown in UI
  enabled: boolean // Whether this item executes during a switch
}
```

## Union Type

The `ConfigItem` type is a discriminated union:

```ts
type ConfigItem = FileReplaceItem | EnvVarItem | RunCommandItem
```

TypeScript narrows the type based on the `type` field:

```ts
if (item.type === 'file-replace') {
  // item is FileReplaceItem — has targetPath, content
} else if (item.type === 'env-var') {
  // item is EnvVarItem — has name, value, shellFile
} else if (item.type === 'run-command') {
  // item is RunCommandItem — has command, workingDir, timeout
}
```

## Anchors

An anchor is an optional marker on a `file-replace` or `env-var` item that identifies which account owns the current disk content. When sync runs, it checks the anchor first — if the anchor value doesn't match, the item is skipped (the file belongs to a different account).

### Anchor Types

There are three anchor types. Which types are allowed depends on the config item type:

| Anchor type | Allowed on | Description |
|-------------|-----------|-------------|
| `json-path` | `file-replace` only | Match a value at a dot-notation path in a JSON file |
| `line-content` | `file-replace` only | Match the exact content of a specific line number |
| `env-value` | `env-var` only | Match the current value of an env var in the shell file |

#### `json-path`

Reads the target file as JSON and checks whether the value at `path` (dot notation) equals `value`.

```ts
interface JsonPathAnchor {
  type: 'json-path'
  path: string   // Dot-notation path (e.g., "tokens.account_id")
  value: string  // Expected value
}
```

**Example:** For `~/.codex/auth.json` containing `{ "tokens": { "account_id": "acct_123" } }`, an anchor with `path: "tokens.account_id"` and `value: "acct_123"` would match.

#### `line-content`

Checks whether a specific line (1-based) in the target file exactly equals `value`.

```ts
interface LineContentAnchor {
  type: 'line-content'
  line: number   // 1-based line number
  value: string  // Expected line content
}
```

#### `env-value`

Checks whether the env var's current value in the shell file matches `value`. Only valid on `env-var` items.

```ts
interface EnvValueAnchor {
  type: 'env-value'
  name: string   // Env var name (e.g., "ANTHROPIC_AUTH_TOKEN")
  value: string  // Expected value
}
```

### Type Constraints

The anchor type must be compatible with the config item type:

- **`file-replace`** items accept: `json-path` or `line-content`
- **`env-var`** items accept: `env-value` only
- **`run-command`** items: anchors are not supported

Invalid combinations are rejected by the sync service.

### Union Type

```ts
type AnchorConfig = JsonPathAnchor | EnvValueAnchor | LineContentAnchor
```

The `anchor` field is optional on `FileReplaceItem` and `EnvVarItem`:

```ts
interface FileReplaceItem extends BaseConfigItem {
  type: 'file-replace'
  targetPath: string
  content: string
  anchor?: AnchorConfig  // json-path or line-content only
}

interface EnvVarItem extends BaseConfigItem {
  type: 'env-var'
  name: string
  value: string
  shellFile: string
  anchor?: AnchorConfig  // env-value only
}
```

## Execution Order

During a profile switch, enabled items execute in a fixed order by type:

1. **`file-replace`** items — executed sequentially
2. **`env-var`** items — executed sequentially (only if all file-replace items succeeded)
3. **`run-command`** items — executed sequentially (only if all file-replace and env-var items succeeded)

If any `file-replace` or `env-var` item fails, execution stops and all file/env changes are rolled back from backup. `run-command` failures do not trigger rollback (side effects cannot be undone).

## Adding a New Config Item Type

To add a new type (e.g., `registry-key`):

1. **Define the interface** in `src/shared/types.ts`:
   ```ts
   export interface RegistryKeyItem extends BaseConfigItem {
     type: 'registry-key'
     key: string
     value: string
   }
   ```

2. **Add to the union type** in `src/shared/types.ts`:
   ```ts
   export type ConfigItem = FileReplaceItem | EnvVarItem | RunCommandItem | RegistryKeyItem
   ```

3. **Add execution handler** in `src/main/switch-engine.ts`:
   - Add a new `private async executeRegistryKey(item: RegistryKeyItem)` method.
   - Add a new phase in `executeSwitch()` following the existing pattern.

4. **Add UI form** in `src/renderer/src/lib/ConfigItemForm.svelte`:
   - Add the new type to the type selector dropdown.
   - Add form fields for the type-specific properties.

5. **Update backup logic** if the new type modifies files that should be backed up.
