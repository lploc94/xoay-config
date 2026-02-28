import { readFile, access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ConfigItem, EnvVarItem, FileReplaceItem } from '../shared/types'
import { PRESETS } from './presets'

function expandHome(p: string): string {
  if (p.startsWith('~/')) {
    return join(homedir(), p.slice(2))
  }
  return p
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function safeReadFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf-8')
  } catch {
    return null
  }
}

function extractEnvVar(shellContent: string, varName: string): string | null {
  const pattern = new RegExp(`^export\\s+${varName}=["']?(.+?)["']?\\s*$`, 'm')
  const match = shellContent.match(pattern)
  return match ? match[1] : null
}

/**
 * Import current config from disk based on a preset (or auto-detect).
 * Reads real files and fills content into preset default items.
 * Items whose files don't exist are skipped.
 * Returns ConfigItem[] — the caller creates the profile.
 */
export async function importCurrentConfig(presetId?: string): Promise<ConfigItem[]> {
  const presetIds = presetId ? [presetId] : await autoDetectPresets()

  const items: ConfigItem[] = []
  const shellCache = new Map<string, string | null>()

  for (const pid of presetIds) {
    const preset = PRESETS.find((p) => p.id === pid)
    if (!preset) continue

    for (const template of preset.defaultItems) {
      if (template.type === 'file-replace') {
        const tmpl = template as FileReplaceItem
        const absPath = expandHome(tmpl.targetPath)
        const content = await safeReadFile(absPath)
        if (content === null) continue

        items.push({
          id: randomUUID(),
          type: 'file-replace',
          label: tmpl.label,
          enabled: true,
          targetPath: tmpl.targetPath,
          content
        })
      } else if (template.type === 'env-var') {
        const tmpl = template as EnvVarItem
        const shellPath = expandHome(tmpl.shellFile)

        if (!shellCache.has(shellPath)) {
          shellCache.set(shellPath, await safeReadFile(shellPath))
        }
        const shellContent = shellCache.get(shellPath)
        if (!shellContent) continue

        const value = extractEnvVar(shellContent, tmpl.name)
        if (value === null) continue

        items.push({
          id: randomUUID(),
          type: 'env-var',
          label: tmpl.label,
          enabled: true,
          name: tmpl.name,
          value,
          shellFile: tmpl.shellFile
        })
      }
    }
  }

  return items
}

/**
 * Auto-detect which presets are relevant by checking if their config files exist on disk.
 */
export async function autoDetectPresets(): Promise<string[]> {
  const detected: string[] = []

  for (const preset of PRESETS) {
    for (const item of preset.defaultItems) {
      if (item.type === 'file-replace') {
        const absPath = expandHome((item as FileReplaceItem).targetPath)
        if (await fileExists(absPath)) {
          detected.push(preset.id)
          break
        }
      }
    }
  }

  return detected
}
