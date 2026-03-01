import { store, listProfiles, listCategories } from './storage'
import type { Category, Profile } from '../shared/types'

const BUILT_IN_CATEGORIES: Omit<Category, 'createdAt' | 'updatedAt'>[] = [
  { id: 'cat-claude-code', name: 'Claude Code', builtIn: true },
  { id: 'cat-codex-cli', name: 'Codex CLI', builtIn: true }
]

const UNCATEGORIZED_CATEGORY: Omit<Category, 'createdAt' | 'updatedAt'> = {
  id: 'cat-uncategorized',
  name: 'Uncategorized',
  builtIn: false
}

export function runMigrations(): void {
  try {
    const version = store.get('schemaVersion')
    if (version >= 2) return

    migrateV1toV2()

    store.set('schemaVersion', 2)
    console.log('[migration] Schema migrated to version 2')
  } catch (err) {
    console.error('[migration] Migration failed — will retry next launch:', err)
  }
}

function migrateV1toV2(): void {
  // Step 1: Create built-in categories if categories array is empty/missing
  const existingCategories = listCategories()
  if (existingCategories.length === 0) {
    const now = new Date().toISOString()
    const categories: Category[] = BUILT_IN_CATEGORIES.map((c) => ({
      ...c,
      createdAt: now,
      updatedAt: now
    }))
    store.set('categories', categories)
  }

  // Step 2: Assign categoryId to each profile based on presetId
  let needsUncategorized = false
  const profiles = listProfiles()
  const updatedProfiles: Profile[] = profiles.map((p) => {
    if (p.categoryId) return p // already has a category

    let categoryId: string
    if (p.presetId === 'claude-code') {
      categoryId = 'cat-claude-code'
    } else if (p.presetId === 'codex-cli') {
      categoryId = 'cat-codex-cli'
    } else {
      categoryId = 'cat-uncategorized'
      needsUncategorized = true
    }

    return { ...p, categoryId }
  })

  // Create "Uncategorized" category if needed
  if (needsUncategorized) {
    const categories = store.get('categories') as Category[]
    const alreadyExists = categories.some((c) => c.id === 'cat-uncategorized')
    if (!alreadyExists) {
      const now = new Date().toISOString()
      categories.push({
        ...UNCATEGORIZED_CATEGORY,
        createdAt: now,
        updatedAt: now
      })
      store.set('categories', categories)
    }
  }

  store.set('profiles', updatedProfiles)

  // Step 3: Convert activeProfileId (singular) → activeProfileIds (record)
  // Read old field directly — it's not in the typed schema anymore
  const oldActiveProfileId = (store as any).get('activeProfileId') as string | null | undefined

  if (oldActiveProfileId) {
    // Find the profile to look up its categoryId
    const activeProfile = updatedProfiles.find((p) => p.id === oldActiveProfileId)
    if (activeProfile && activeProfile.categoryId) {
      const currentActiveIds = store.get('activeProfileIds') ?? {}
      store.set('activeProfileIds', {
        ...currentActiveIds,
        [activeProfile.categoryId]: oldActiveProfileId
      })
    }
  }
  // If oldActiveProfileId is null/undefined → activeProfileIds stays as {} (default)
  // DO NOT delete old activeProfileId field — keep for rollback safety
}
