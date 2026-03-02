import Store from 'electron-store'
import { randomUUID } from 'crypto'
import type { AppState, Profile, Category, ConfigItem, CreateProfileReq, DisplayItem, ConfigUpdate } from '../shared/types'
import { getPresetById, getBuiltInHooks } from './preset-loader'
import { stopCronHooks, stopBackgroundCrons } from './cron-scheduler'

const store = new Store<AppState>({
  name: 'xoay-config',
  defaults: {
    schemaVersion: 3,
    categories: [],
    profiles: [],
    activeProfileIds: {},
    hookDisplayData: {},
    hookDisplayTimestamps: {}
  }
})

// ── Schema Migration ─────────────────────────────────────────────

/**
 * Migrate hookDisplayData from old format Record<string, Record<string, HookDisplayValue>>
 * to new format Record<string, DisplayItem[]>.
 */
function migrateHookDisplayData(): void {
  const raw = store.get('hookDisplayData') as Record<string, unknown> ?? {}
  let changed = false

  for (const [profileId, value] of Object.entries(raw)) {
    if (Array.isArray(value)) continue // already new format

    // Old format: Record<string, { value, label?, status? }>
    if (value && typeof value === 'object') {
      const items: DisplayItem[] = []
      for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
        if (val && typeof val === 'object') {
          const v = val as { value?: string | null; label?: string; status?: 'ok' | 'warning' | 'error' }
          items.push({
            type: 'text',
            label: v.label ?? key,
            value: v.value ?? null,
            status: v.status
          })
        }
      }
      ;(raw as Record<string, unknown>)[profileId] = items
      changed = true
    }
  }

  if (changed) {
    store.set('hookDisplayData', raw as Record<string, DisplayItem[]>)
  }
}

function migrateStore(): void {
  const version = store.get('schemaVersion') ?? 1
  if (version < 2) {
    migrateHookDisplayData()
    store.set('schemaVersion', 2)
  }
  // v2→v3 migration is handled by runMigrations() in migration.ts
}

migrateStore()

// ── Helpers ──────────────────────────────────────────────────────

/** Ensure profiles from older versions have hooks: [] and categoryId */
function normalizeProfile(p: Profile): Profile {
  const needsHooks = !p.hooks
  const needsCategoryId = !p.categoryId
  if (needsHooks || needsCategoryId) {
    return {
      ...p,
      hooks: needsHooks ? [] : p.hooks,
      categoryId: needsCategoryId ? '' : p.categoryId
    }
  }
  return p
}

// ── Profile CRUD ─────────────────────────────────────────────────

export function listProfiles(categoryId?: string): Profile[] {
  const profiles = store.get('profiles').map(normalizeProfile)
  if (categoryId !== undefined) {
    return profiles.filter((p) => p.categoryId === categoryId)
  }
  return profiles
}

export function getProfile(id: string): Profile | null {
  const profiles = store.get('profiles')
  const found = profiles.find((p) => p.id === id)
  return found ? normalizeProfile(found) : null
}

export function createProfile(req: CreateProfileReq): Profile {
  let items: ConfigItem[] = req.items ?? []

  // Only use preset defaults when caller didn't supply items
  if (req.presetId && items.length === 0) {
    const preset = getPresetById(req.presetId)
    if (preset) {
      // Deep-clone preset items and assign new IDs
      items = preset.defaultItems.map((item) => ({
        ...item,
        id: randomUUID()
      }))
    }
  }

  const now = new Date().toISOString()
  const profile: Profile = {
    id: randomUUID(),
    name: req.name,
    categoryId: req.categoryId,
    presetId: req.presetId,
    items,
    hooks: getBuiltInHooks(),
    createdAt: now,
    updatedAt: now
  }

  const profiles = store.get('profiles')
  profiles.push(profile)
  store.set('profiles', profiles)
  return profile
}

export function updateProfile(profile: Profile): Profile {
  const profiles = store.get('profiles')
  const idx = profiles.findIndex((p) => p.id === profile.id)
  if (idx === -1) {
    throw new Error(`Profile not found: ${profile.id}`)
  }
  profile.updatedAt = new Date().toISOString()
  profiles[idx] = profile
  store.set('profiles', profiles)
  return profile
}

export function deleteProfile(id: string): void {
  const profiles = store.get('profiles')
  const profile = profiles.find((p) => p.id === id)
  if (!profile) {
    throw new Error(`Profile not found: ${id}`)
  }

  // Stop all crons (profile + background) before deleting
  stopCronHooks(id)
  stopBackgroundCrons(id)

  store.set(
    'profiles',
    profiles.filter((p) => p.id !== id)
  )

  // Clear active if deleted profile was active in its category
  const activeIds = store.get('activeProfileIds')
  const normalizedProfile = normalizeProfile(profile)
  if (normalizedProfile.categoryId && activeIds[normalizedProfile.categoryId] === id) {
    const { [normalizedProfile.categoryId]: _, ...rest } = activeIds
    store.set('activeProfileIds', rest)
  }
}

// ── Active Profile (per-category) ───────────────────────────────

export function getActiveProfileId(categoryId: string): string | null {
  const activeIds = store.get('activeProfileIds')
  return activeIds[categoryId] ?? null
}

export function setActiveProfileId(categoryId: string, profileId: string | null): void {
  const activeIds = store.get('activeProfileIds')
  if (profileId === null) {
    const { [categoryId]: _, ...rest } = activeIds
    store.set('activeProfileIds', rest)
  } else {
    store.set('activeProfileIds', { ...activeIds, [categoryId]: profileId })
  }
}

export function getAllActiveProfileIds(): Record<string, string> {
  return store.get('activeProfileIds')
}

// ── Category CRUD ───────────────────────────────────────────────

export function listCategories(): Category[] {
  return store.get('categories')
}

export function createCategory(name: string, opts?: { icon?: string; builtIn?: boolean }): Category {
  const now = new Date().toISOString()
  const category: Category = {
    id: randomUUID(),
    name,
    icon: opts?.icon,
    builtIn: opts?.builtIn ?? false,
    createdAt: now,
    updatedAt: now
  }

  const categories = store.get('categories')
  categories.push(category)
  store.set('categories', categories)
  return category
}

export function updateCategory(category: Category): Category {
  const categories = store.get('categories')
  const idx = categories.findIndex((c) => c.id === category.id)
  if (idx === -1) {
    throw new Error(`Category not found: ${category.id}`)
  }
  category.updatedAt = new Date().toISOString()
  categories[idx] = category
  store.set('categories', categories)
  return category
}

export function deleteCategory(id: string): void {
  const categories = store.get('categories')
  const filtered = categories.filter((c) => c.id !== id)
  if (filtered.length === categories.length) {
    throw new Error(`Category not found: ${id}`)
  }

  // 1. Stop cron hooks for ALL profiles in this category (profile + background)
  const categoryProfiles = store.get('profiles').filter((p) => p.categoryId === id)
  for (const p of categoryProfiles) {
    stopCronHooks(p.id)
    stopBackgroundCrons(p.id)
  }

  // 2. Remove activeProfileIds entry for this category
  const activeIds = store.get('activeProfileIds')
  const { [id]: _, ...restActiveIds } = activeIds
  store.set('activeProfileIds', restActiveIds)

  // 3. Remove all profiles belonging to this category
  store.set(
    'profiles',
    store.get('profiles').filter((p) => p.categoryId !== id)
  )

  // 4. Remove the category
  store.set('categories', filtered)
}

// ── Hook Display Data ────────────────────────────────────────────

/**
 * Safely read hookDisplayData from store, ensuring new DisplayItem[] format.
 * All read sites should use this instead of casting store.get('hookDisplayData') directly.
 */
export function getHookDisplayData(): Record<string, DisplayItem[]> {
  const raw = store.get('hookDisplayData') as Record<string, unknown> ?? {}
  const result: Record<string, DisplayItem[]> = {}

  for (const [profileId, value] of Object.entries(raw)) {
    if (Array.isArray(value)) {
      result[profileId] = value as DisplayItem[]
    }
    // Skip non-array entries (shouldn't happen after migration, but defensive)
  }

  return result
}

// ── Config Updates (from hooks) ──────────────────────────────────

/**
 * Apply config updates from hook output to a profile's items.
 * Each update targets a specific item by ID and updates content/value.
 */
export function applyConfigUpdates(profileId: string, updates: ConfigUpdate[]): void {
  const profile = getProfile(profileId)
  if (!profile) {
    console.warn(`[applyConfigUpdates] Profile not found: ${profileId}`)
    return
  }

  let changed = false

  for (const update of updates) {
    const item = profile.items.find((i) => i.id === update.itemId)
    if (!item) {
      console.warn(`[applyConfigUpdates] Item not found: ${update.itemId} in profile ${profileId}`)
      continue
    }

    if (item.type === 'file-replace') {
      if (update.content !== undefined) {
        item.content = update.content
        changed = true
      } else if (update.value !== undefined) {
        console.warn(`[applyConfigUpdates] Item ${update.itemId} is file-replace but only 'value' was provided — skipping`)
      }
    } else if (item.type === 'env-var') {
      if (update.value !== undefined) {
        item.value = update.value
        changed = true
      } else if (update.content !== undefined) {
        console.warn(`[applyConfigUpdates] Item ${update.itemId} is env-var but only 'content' was provided — skipping`)
      }
    }
  }

  if (changed) {
    updateProfile(profile)
  }
}

// ── Backups ──────────────────────────────────────────────────────

export { store }
