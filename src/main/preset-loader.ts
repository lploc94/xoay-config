import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import { randomUUID, createHash } from 'crypto'
import type { Preset, PresetFile, PresetHookDef, ConfigItem, Category, ProfileHook } from '../shared/types'
import { PATHS } from './paths'

// ── Built-in hook definitions ────────────────────────────────────

/** Hook definitions that are automatically attached to every new profile. */
const BUILT_IN_HOOKS: Omit<ProfileHook, 'id'>[] = [
  {
    label: 'Sync Config',
    enabled: true,
    type: 'pre-switch-out',
    scriptPath: 'builtin/sync-config.js',
    builtIn: true
  }
]

/** Return built-in hooks with fresh UUIDs for attaching to a new profile. */
export function getBuiltInHooks(): ProfileHook[] {
  return BUILT_IN_HOOKS.map((h) => ({ ...h, id: randomUUID() }))
}

// ── Resource path resolution ────────────────────────────────────

function getResourcePresetsPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'resources', 'presets')
  }
  return path.join(__dirname, '../../resources/presets')
}

// ── Preset file loading ─────────────────────────────────────────

function readPresetFile(filePath: string): PresetFile | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    const data = JSON.parse(raw) as PresetFile
    if (!data.$schema || !data.id || !data.name) return null
    return data
  } catch {
    return null
  }
}

export function loadPresetsFromDir(dir: string): PresetFile[] {
  if (!fs.existsSync(dir)) return []
  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.xoay-preset.json'))
    const presets: PresetFile[] = []
    for (const file of files) {
      const preset = readPresetFile(path.join(dir, file))
      if (preset) presets.push(preset)
    }
    return presets
  } catch {
    return []
  }
}

export function loadBuiltinPresets(): PresetFile[] {
  return loadPresetsFromDir(getResourcePresetsPath())
}

export function loadUserPresets(): PresetFile[] {
  return loadPresetsFromDir(PATHS.presets)
}

// ── Convert PresetFile → runtime Preset ─────────────────────────

function presetFileToPreset(pf: PresetFile): Preset {
  const defaultItems: ConfigItem[] = []
  const extraHooks: PresetHookDef[] = []

  for (const item of pf.defaultItems) {
    const base = { id: '', label: item.label, enabled: item.enabled }
    switch (item.type) {
      case 'file-replace':
        defaultItems.push({ ...base, type: 'file-replace' as const, targetPath: item.targetPath ?? '', content: '' })
        break
      case 'env-var':
        defaultItems.push({ ...base, type: 'env-var' as const, name: item.name ?? '', value: item.value ?? '', shellFile: item.shellFile ?? '~/.zshrc' })
        break
      case 'run-command': {
        // Legacy run-command items → report as hook defs (no disk writes here).
        // Actual script files are written in importPresetFile() / ensureRunCommandScript().
        const timeout: number = item.timeout ?? 30000
        const scriptName = runCommandScriptName(pf.id, item)

        extraHooks.push({
          label: item.label ?? 'Migrated Command',
          type: 'post-switch-in',
          timeout,
          scriptFile: scriptName
        })
        break
      }
      default:
        defaultItems.push({ ...base, type: 'file-replace' as const, targetPath: '', content: '' })
    }
  }

  return {
    id: pf.id,
    name: pf.name,
    description: pf.description,
    categoryName: pf.categoryName,
    defaultItems,
    hooks: [...(pf.hooks ?? []), ...extraHooks]
  }
}

/**
 * Deterministic script filename for a legacy run-command preset item.
 * Uses a hash of preset ID + command + workingDir so the name is stable across calls.
 */
function runCommandScriptName(presetId: string, item: { command?: string; workingDir?: string }): string {
  const hash = createHash('sha256')
    .update(`${presetId}:${item.command ?? ''}:${item.workingDir ?? ''}`)
    .digest('hex')
    .slice(0, 12)
  return `preset-cmd-${hash}.js`
}

/**
 * Write the hook script for a legacy run-command preset item, if it doesn't already exist.
 * Called from importPresetFile() — the only mutation path.
 */
function ensureRunCommandScript(presetId: string, item: { label?: string; command?: string; workingDir?: string; timeout?: number }): void {
  const scriptName = runCommandScriptName(presetId, item)
  const scriptPath = path.join(PATHS.hooks, scriptName)

  if (fs.existsSync(scriptPath)) return // already written — idempotent

  const command: string = item.command ?? ''
  const workingDir: string = item.workingDir ?? ''
  const timeout: number = item.timeout ?? 30000

  const scriptContent = [
    `// Auto-migrated from preset run-command item: ${item.label ?? ''}`,
    `const os = require('os');`,
    `const { execSync } = require('child_process');`,
    `let cwd = ${JSON.stringify(workingDir)} || os.homedir();`,
    `if (cwd.startsWith('~')) cwd = os.homedir() + cwd.slice(1);`,
    `try {`,
    `  execSync(${JSON.stringify(command)}, {`,
    `    cwd,`,
    `    stdio: 'inherit',`,
    `    timeout: ${timeout}`,
    `  });`,
    `} catch (e) {`,
    `  console.error('Preset migration hook failed:', e.message);`,
    `  process.exit(1);`,
    `}`
  ].join('\n')

  fs.mkdirSync(PATHS.hooks, { recursive: true })
  fs.writeFileSync(scriptPath, scriptContent, 'utf-8')
}

// ── Public API ──────────────────────────────────────────────────

/**
 * Convert preset hook definitions to runtime ProfileHook objects.
 * Resolves scriptFile to scriptPath based on where the script exists on disk:
 * - `<presetId>/<scriptFile>` for preset hooks extracted during import
 * - `builtin/<scriptFile>` for scripts provisioned into the builtin hooks dir
 * - `<scriptFile>` for run-command converted hooks (at hooks root)
 */
export function presetHooksToProfileHooks(presetId: string, hookDefs: PresetHookDef[]): ProfileHook[] {
  return hookDefs.map((def) => {
    let scriptPath = def.scriptFile

    const nestedPath = path.join(presetId, def.scriptFile)
    const builtinPath = path.join('builtin', def.scriptFile)

    if (fs.existsSync(path.join(PATHS.hooks, nestedPath))) {
      scriptPath = nestedPath
    } else if (fs.existsSync(path.join(PATHS.hooks, builtinPath))) {
      scriptPath = builtinPath
    }

    return {
      id: randomUUID(),
      label: def.label,
      enabled: true,
      type: def.type,
      scriptPath,
      cronIntervalMs: def.cronIntervalMs,
      timeout: def.timeout
    }
  })
}

export function getAllPresets(): Preset[] {
  const builtinFiles = loadBuiltinPresets()
  const userFiles = loadUserPresets()
  const all = [...builtinFiles, ...userFiles]

  // Deduplicate by id — user presets override builtins
  const byId = new Map<string, PresetFile>()
  for (const pf of all) {
    byId.set(pf.id, pf)
  }

  return Array.from(byId.values()).map(presetFileToPreset)
}

export function getPresetById(id: string): Preset | undefined {
  return getAllPresets().find((p) => p.id === id)
}

// ── Category matching ───────────────────────────────────────────

function findOrCreateCategory(categoryName: string): Category {
  // Lazy require to avoid circular dependency (storage → preset-loader → storage)
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { listCategories, createCategory } = require('./storage')
  const existing: Category[] = listCategories()
  const match = existing.find((c) => c.name === categoryName)
  if (match) return match
  return createCategory(categoryName) as Category
}

// ── Import preset file ──────────────────────────────────────────

export function importPresetFile(filePath: string): { preset: Preset; category: Category } | null {
  const pf = readPresetFile(filePath)
  if (!pf) return null

  // Extract scripts to hooks dir
  if (pf.scripts) {
    const presetHooksDir = path.join(PATHS.hooks, pf.id)
    fs.mkdirSync(presetHooksDir, { recursive: true })
    for (const [filename, base64Content] of Object.entries(pf.scripts)) {
      // Guard 1: reject filenames with path separators
      if (filename.includes('/') || filename.includes('\\')) continue
      const destPath = path.join(presetHooksDir, filename)
      // Guard 2: ensure resolved path stays inside presetHooksDir
      if (!destPath.startsWith(presetHooksDir)) continue
      fs.writeFileSync(destPath, Buffer.from(base64Content, 'base64'))
    }
  }

  // Copy preset file to user presets dir
  fs.mkdirSync(PATHS.presets, { recursive: true })
  const destPresetPath = path.join(PATHS.presets, path.basename(filePath))
  if (path.resolve(filePath) !== path.resolve(destPresetPath)) {
    fs.copyFileSync(filePath, destPresetPath)
  }

  const category = findOrCreateCategory(pf.categoryName)

  // Write hook scripts for any legacy run-command items (mutation happens here, not in presetFileToPreset)
  for (const item of pf.defaultItems) {
    if (item.type === 'run-command') {
      ensureRunCommandScript(pf.id, item)
    }
  }

  const preset = presetFileToPreset(pf)

  return { preset, category }
}

// ── Export preset ───────────────────────────────────────────────

export function exportPreset(
  preset: Preset,
  hooks: ProfileHook[],
  categoryName: string,
  outputPath: string
): void {
  const pf: PresetFile = {
    $schema: 'xoay-preset/v1',
    id: preset.id,
    name: preset.name,
    description: preset.description,
    categoryName,
    defaultItems: preset.defaultItems.map((item) => {
      const base = { type: item.type, label: item.label, enabled: item.enabled }
      switch (item.type) {
        case 'file-replace':
          return { ...base, targetPath: item.targetPath }
        case 'env-var':
          return { ...base, name: item.name, value: item.value, shellFile: item.shellFile }
        default:
          return base
      }
    }),
    hooks: hooks.map((h): PresetHookDef => ({
      label: h.label,
      type: h.type,
      cronIntervalMs: h.cronIntervalMs,
      timeout: h.timeout,
      scriptFile: path.basename(h.scriptPath)
    })),
    scripts: {}
  }

  // Embed hook scripts as base64
  for (const hook of hooks) {
    const scriptAbsPath = path.isAbsolute(hook.scriptPath)
      ? hook.scriptPath
      : path.join(PATHS.hooks, hook.scriptPath)
    const filename = path.basename(scriptAbsPath)
    try {
      const content = fs.readFileSync(scriptAbsPath)
      pf.scripts![filename] = content.toString('base64')
    } catch {
      // Skip scripts that can't be read
    }
  }

  // Remove empty scripts object
  if (Object.keys(pf.scripts!).length === 0) {
    delete pf.scripts
  }

  // Remove empty hooks array
  if (pf.hooks && pf.hooks.length === 0) {
    delete pf.hooks
  }

  fs.writeFileSync(outputPath, JSON.stringify(pf, null, 2) + '\n')
}
