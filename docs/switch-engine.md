# Switch Engine

The switch engine (`src/main/switch-engine.ts`) is responsible for executing profile switches — applying config items to the system, managing backups, and handling rollback on failure.

## Singleton

The engine is exported as a shared singleton:

```ts
export const switchEngine = new SwitchEngine()
```

This ensures the concurrency lock works across both IPC calls (from the renderer) and tray menu actions.

## Concurrency Lock

Only one switch operation can run at a time:

```ts
private isSwitching = false

async switch(profile: Profile): Promise<SwitchResult> {
  if (this.isSwitching) {
    throw new Error('Switch operation already in progress')
  }
  this.isSwitching = true
  try {
    return await this.executeSwitch(profile)
  } finally {
    this.isSwitching = false
  }
}
```

If a second switch is attempted while one is in progress, it throws immediately. The lock is released in the `finally` block regardless of success or failure.

## Execution Flow

When `switch(profile)` is called:

```
1. Filter enabled items from profile.items
2. Create backup of all target files
3. Phase 1: Execute file-replace items (sequentially)
   └─ On failure → stop, rollback, skip remaining phases
4. Phase 2: Execute env-var items (sequentially)
   └─ On failure → stop, rollback, skip Phase 3
5. If Phase 1 or 2 failed → restore all files from backup
6. Phase 3: Execute run-command items (sequentially)
   └─ On failure → stop (no rollback — side effects cannot be undone)
7. Return SwitchResult with per-item results
```

Key behaviors:
- Only **enabled** items (`item.enabled === true`) are executed.
- Items execute **sequentially** within each phase, in array order.
- Phases execute in the fixed order: `file-replace` → `env-var` → `run-command`.
- If any `file-replace` or `env-var` fails, execution stops and rollback runs.
- `run-command` failures stop execution but do NOT trigger rollback.

## Backup System

Before executing any items, the engine creates a backup of all files that will be modified.

### Backup Directory

```
~/.xoay/backups/<backupId>/
  _meta.json         # Backup metadata
  <base64url-encoded-path-1>  # Backup of first file
  <base64url-encoded-path-2>  # Backup of second file
  ...
```

The `backupId` format is `<ISO-timestamp>_<profileId>`, with special characters replaced: `2024-01-15T10-30-00-000Z_<uuid>`.

### What Gets Backed Up

- All `file-replace` target files (the `targetPath` of each item)
- All `env-var` shell files (the `shellFile` of each item)
- Files that don't exist are skipped (they're new files, no backup needed)

### Backup Metadata

Each backup directory contains a `_meta.json`:

```ts
interface BackupEntry {
  id: string
  profileId: string
  profileName: string
  timestamp: string        // ISO 8601
  files: string[]          // Absolute paths of backed-up files
}
```

### File Encoding

Backup files are named using base64url encoding of the full absolute path:

```ts
const encodedName = Buffer.from(filePath).toString('base64url')
```

This ensures unique filenames even for deeply nested paths.

## Rollback

If a `file-replace` or `env-var` item fails, the engine restores all backed-up files:

```ts
async restoreBackup(backupId: string): Promise<void>
```

Rollback process:
1. Read `_meta.json` from the backup directory
2. For each backed-up file:
   - Ensure the target directory exists
   - Copy backup to a temp file (`.xoay-restore-<filename>.tmp`)
   - Atomic rename temp file → target file

This two-step approach (copy → rename) ensures atomicity — if the process crashes mid-restore, the original file is not corrupted.

## File Operations

### Atomic Writes (`file-replace`)

File replacements use a temp-file-then-rename strategy:

```ts
const tempPath = join(dirname(targetPath), `.xoay-${basename(targetPath)}.tmp`)
await writeFile(tempPath, item.content, 'utf-8')
await rename(tempPath, targetPath)
```

1. Write content to a temporary file in the same directory
2. Atomically rename temp → target

This prevents partial writes — the target file either has the old content or the complete new content, never a half-written state.

### Path Resolution

All paths support `~` for the home directory:

```ts
private resolvePath(p: string): string {
  if (p.startsWith('~/')) {
    return join(homedir(), p.slice(2))
  }
  return p
}
```

## Env Var Regex Strategy

The `env-var` handler modifies shell config files (e.g., `~/.zshrc`) using regex:

### Find Pattern

```ts
const pattern = new RegExp(`^export\\s+${escapeRegex(item.name)}=.*$`, 'gm')
```

This matches lines like:
- `export ANTHROPIC_BASE_URL=https://api.example.com`
- `export ANTHROPIC_BASE_URL="https://api.example.com"`

### Comment Detection

```ts
const commentPattern = new RegExp(`^#\\s*export\\s+${escapeRegex(item.name)}=.*$`, 'm')
```

Lines starting with `#` (commented out) are **not** replaced. If only a commented version exists, a new uncommented line is appended.

### Replace Logic

1. If an uncommented `export NAME=...` line exists → **replace it**
2. If only a commented `#export NAME=...` exists → **append new line** (keeps the comment)
3. If not found at all → **append new line**

### Value Escaping

Values are escaped for shell safety before writing:

```ts
const escapedValue = item.value
  .replace(/\\/g, '\\\\')  // backslashes
  .replace(/"/g, '\\"')     // double quotes
  .replace(/\$/g, '\\$')   // dollar signs
  .replace(/`/g, '\\`')    // backticks
```

The final export line uses double quotes: `export NAME="escaped-value"`

### Env Var Name Validation

Names must match `^[A-Za-z_][A-Za-z0-9_]*$`. Invalid names cause the item to fail with an error.

## Run Command Execution

### Spawning

Commands are executed via `spawn('sh', ['-c', command])`:

```ts
const child = spawn('sh', ['-c', item.command], {
  cwd: workingDir,         // item.workingDir or $HOME
  env: process.env,        // Inherits current environment
  stdio: ['ignore', 'pipe', 'pipe']
})
```

### Timeout

Default timeout is 30 seconds (`30_000` ms). Each item can override this via `item.timeout`.

Timeout handling:
1. After `timeout` ms → send `SIGTERM`
2. After 5 additional seconds → send `SIGKILL` (force kill)

```ts
const timer = setTimeout(() => {
  killed = true
  child.kill('SIGTERM')
  setTimeout(() => {
    if (!child.killed) child.kill('SIGKILL')
  }, 5000)
}, timeout)
```

### Result Capture

Both stdout and stderr are captured and returned in `ItemResult`:

```ts
interface ItemResult {
  itemId: string
  type?: ConfigItem['type']
  label?: string
  success: boolean
  error?: string
  stdout?: string
  stderr?: string
}
```

A command succeeds if it exits with code 0. Any non-zero exit code or timeout results in a failure.
