import * as fs from 'fs'
import * as path from 'path'
import { randomUUID } from 'crypto'
import { store, listProfiles, listCategories } from './storage'
import { getHooksDir } from './hook-storage'
import type { Category, Profile, ProfileHook } from '../shared/types'

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
    if (version >= 3) return

    if (version < 2) {
      migrateV1toV2()
      store.set('schemaVersion', 2)
      console.log('[migration] Schema migrated to version 2')
    }

    if (version < 3) {
      migrateV2toV3()
      store.set('schemaVersion', 3)
      console.log('[migration] Schema migrated to version 3')
    }
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

/** Migrate run-command items to hooks, strip anchor fields from config items. */
function migrateV2toV3(): void {
  const hooksDir = getHooksDir()
  fs.mkdirSync(hooksDir, { recursive: true })

  const profiles = store.get('profiles') as any[]
  const updatedProfiles: Profile[] = profiles.map((p) => {
    const hooks: ProfileHook[] = Array.isArray(p.hooks) ? [...p.hooks] : []

    // Convert run-command items to post-switch-in hooks
    const items = Array.isArray(p.items) ? p.items : []
    for (const item of items) {
      if (item.type !== 'run-command') continue

      const command: string = item.command ?? ''
      const workingDir: string = item.workingDir ?? ''
      const timeout: number = item.timeout ?? 30000

      // Generate a JS script that runs the command
      const scriptName = `migrated-${randomUUID()}.js`
      const scriptPath = path.join(hooksDir, scriptName)
      const lines = [
        `// Auto-migrated from run-command item: ${item.label ?? ''}`,
        `const { execSync } = require('child_process');`,
        `try {`,
        `  execSync(${JSON.stringify(command)}, {`,
        `    stdio: 'inherit',`,
        workingDir ? `    cwd: ${JSON.stringify(workingDir)},` : '',
        `    timeout: ${timeout}`,
        `  });`,
        `} catch (e) {`,
        `  console.error('Migration hook failed:', e.message);`,
        `  process.exit(1);`,
        `}`
      ].filter(Boolean).join('\n')

      fs.writeFileSync(scriptPath, lines, 'utf-8')

      hooks.push({
        id: randomUUID(),
        label: item.label ?? 'Migrated Command',
        enabled: item.enabled ?? true,
        type: 'post-switch-in',
        scriptPath: scriptName,
        timeout
      })
    }

    // Strip anchor field and keep only file-replace and env-var items
    const cleanedItems = items
      .filter((item: any) => item.type === 'file-replace' || item.type === 'env-var')
      .map((item: any) => {
        const { anchor, ...rest } = item
        return rest
      })

    return { ...p, items: cleanedItems, hooks }
  })

  store.set('profiles', updatedProfiles)
}
