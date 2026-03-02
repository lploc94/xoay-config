import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import { randomUUID } from 'crypto'
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
  const defaultItems: ConfigItem[] = pf.defaultItems.map((item) => {
    const base = { id: '', label: item.label, enabled: item.enabled }
    switch (item.type) {
      case 'file-replace':
        return { ...base, type: 'file-replace' as const, targetPath: item.targetPath ?? '', content: '' }
      case 'env-var':
        return { ...base, type: 'env-var' as const, name: item.name ?? '', value: item.value ?? '', shellFile: item.shellFile ?? '~/.zshrc' }
      default:
        return { ...base, type: 'file-replace' as const, targetPath: '', content: '' }
    }
  })

  return {
    id: pf.id,
    name: pf.name,
    description: pf.description,
    categoryName: pf.categoryName,
    defaultItems,
    hooks: pf.hooks
  }
}

// ── Public API ──────────────────────────────────────────────────

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
