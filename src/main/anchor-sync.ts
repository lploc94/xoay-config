import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type {
  AnchorConfig,
  ConfigItem,
  FileReplaceItem,
  EnvVarItem,
  SyncResult
} from '../shared/types'
import { getProfile, getActiveProfileId, updateProfile } from './storage'

// ── Path helpers ────────────────────────────────────────────────

function resolvePath(p: string): string {
  if (p.startsWith('~/')) {
    return join(homedir(), p.slice(2))
  }
  return p
}

// ── Anchor checking ─────────────────────────────────────────────

function resolveJsonPath(obj: unknown, path: string): unknown {
  const keys = path.split('.')
  let current: unknown = obj
  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined
    }
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function extractEnvValue(content: string, name: string): string | undefined {
  // Match: export NAME=VALUE or export NAME="VALUE" (not commented)
  const pattern = new RegExp(`^export\\s+${escapeRegExp(name)}=(.*)$`, 'm')
  const match = content.match(pattern)
  if (!match) return undefined

  let value = match[1]
  // Strip surrounding quotes if present
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1)
  }
  return value
}

/**
 * Check if an anchor matches the disk content.
 * Returns true if the anchor's expected value matches what's on disk.
 */
export function checkAnchor(anchor: AnchorConfig, diskContent: string): boolean {
  switch (anchor.type) {
    case 'json-path': {
      try {
        const parsed = JSON.parse(diskContent)
        const resolved = resolveJsonPath(parsed, anchor.path)
        return resolved !== undefined && String(resolved) === anchor.value
      } catch {
        // JSON parse error → not a match
        return false
      }
    }

    case 'env-value': {
      const value = extractEnvValue(diskContent, anchor.name)
      return value !== undefined && value === anchor.value
    }

    case 'line-content': {
      const lines = diskContent.split('\n')
      const lineIndex = anchor.line - 1 // 1-based to 0-based
      if (lineIndex < 0 || lineIndex >= lines.length) {
        return false
      }
      return lines[lineIndex] === anchor.value
    }

    default:
      return false
  }
}

// ── Anchor type validation ──────────────────────────────────────

function isValidAnchorForItem(item: FileReplaceItem | EnvVarItem): boolean {
  if (!item.anchor) return true // no anchor is always valid

  if (item.type === 'file-replace') {
    return item.anchor.type === 'json-path' || item.anchor.type === 'line-content'
  }

  if (item.type === 'env-var') {
    return item.anchor.type === 'env-value'
  }

  return false
}

// ── Sync logic ──────────────────────────────────────────────────

/** Internal result that carries disk content to avoid double reads */
interface SyncItemResult extends SyncResult {
  diskContent?: string
}

async function syncItem(item: FileReplaceItem | EnvVarItem): Promise<SyncItemResult> {
  // No anchor → nothing to check
  if (!item.anchor) {
    return { itemId: item.id, synced: false, reason: 'no-change' }
  }

  // Validate anchor type for this item kind
  if (!isValidAnchorForItem(item)) {
    return {
      itemId: item.id,
      synced: false,
      reason: 'error',
      error: 'Invalid anchor type for this item'
    }
  }

  // Determine which file to read from disk
  const filePath = resolvePath(
    item.type === 'file-replace' ? item.targetPath : item.shellFile
  )

  // Check file exists
  if (!existsSync(filePath)) {
    return { itemId: item.id, synced: false, reason: 'file-not-found' }
  }

  // Read disk content
  let diskContent: string
  try {
    diskContent = await readFile(filePath, 'utf-8')
  } catch (err) {
    return {
      itemId: item.id,
      synced: false,
      reason: 'error',
      error: err instanceof Error ? err.message : String(err)
    }
  }

  // Check anchor — special handling for json-path parse errors
  if (item.anchor.type === 'json-path') {
    try {
      JSON.parse(diskContent)
    } catch {
      return {
        itemId: item.id,
        synced: false,
        reason: 'error',
        error: 'Failed to parse JSON from disk file'
      }
    }
  }

  if (!checkAnchor(item.anchor, diskContent)) {
    return { itemId: item.id, synced: false, reason: 'anchor-mismatch' }
  }

  // Anchor matches — compare stored vs disk content
  if (item.type === 'file-replace') {
    if (diskContent === item.content) {
      return { itemId: item.id, synced: false, reason: 'no-change' }
    }
    // Content differs — caller should update stored content
    return { itemId: item.id, synced: true, diskContent }
  }

  // item.type === 'env-var' (only remaining option)
  const diskValue = extractEnvValue(diskContent, item.name)
  if (diskValue === undefined || diskValue === item.value) {
    return { itemId: item.id, synced: false, reason: 'no-change' }
  }
  // Value differs — caller should update stored value
  return { itemId: item.id, synced: true, diskContent }
}

/**
 * Sync a profile's items with disk content.
 * Only updates stored content — does NOT write to disk.
 */
export async function syncProfile(profileId: string): Promise<SyncResult[]> {
  const profile = getProfile(profileId)
  if (!profile) {
    throw new Error('Profile not found')
  }

  // Deep-clone items to avoid mutating the store in-place (ISSUE-3)
  const clonedItems: ConfigItem[] = JSON.parse(JSON.stringify(profile.items))

  const results: SyncResult[] = []
  let anyUpdated = false

  for (const item of clonedItems) {
    // Only file-replace and env-var items can have anchors
    if (item.type !== 'file-replace' && item.type !== 'env-var') {
      continue
    }

    const result = await syncItem(item)
    // Strip internal diskContent before exposing as SyncResult
    const { diskContent, ...syncResult } = result
    results.push(syncResult)

    if (result.synced && diskContent !== undefined) {
      anyUpdated = true

      // Use disk content returned by syncItem — no second read (ISSUE-2)
      if (item.type === 'file-replace') {
        item.content = diskContent
      } else if (item.type === 'env-var') {
        const diskValue = extractEnvValue(diskContent, item.name)
        if (diskValue !== undefined) {
          item.value = diskValue
        }
      }
    }
  }

  // Persist atomically with cloned items (ISSUE-3)
  if (anyUpdated) {
    updateProfile({ ...profile, items: clonedItems })
  }

  return results
}

// ── Periodic sync ───────────────────────────────────────────────

let syncTimer: ReturnType<typeof setInterval> | null = null

export function startPeriodicSync(intervalMs: number): void {
  stopPeriodicSync()
  syncTimer = setInterval(async () => {
    const activeId = getActiveProfileId()
    if (activeId) {
      await syncProfile(activeId)
    }
  }, intervalMs)
}

export function stopPeriodicSync(): void {
  if (syncTimer !== null) {
    clearInterval(syncTimer)
    syncTimer = null
  }
}
