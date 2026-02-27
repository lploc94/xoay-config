# Config Items

Config items are the building blocks of a profile. Each item represents a single configuration action that executes during a profile switch.

## Three Types

### 1. `file-replace`

Replaces the entire contents of a target file with the specified content.

```ts
interface FileReplaceItem extends BaseConfigItem {
  type: 'file-replace'
  targetPath: string  // Absolute path or ~ for home (e.g., "~/.claude/settings.json")
  content: string     // Full file content to write
}
```

**Use case:** Swapping config files like `~/.claude/settings.json`, `~/.codex/config.toml`.

**Execution:** Atomic write via temp file + rename. See [Switch Engine](./switch-engine.md) for details.

### 2. `env-var`

Sets an environment variable in a shell config file (e.g., `~/.zshrc`).

```ts
interface EnvVarItem extends BaseConfigItem {
  type: 'env-var'
  name: string       // Variable name (e.g., "ANTHROPIC_BASE_URL")
  value: string      // Variable value
  shellFile: string  // Shell config file path (e.g., "~/.zshrc")
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
