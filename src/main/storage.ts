import Store from 'electron-store'
import { randomUUID } from 'crypto'
import type { AppState, Profile, ConfigItem, CreateProfileReq } from '../shared/types'
import { getPresetById } from './presets'

const store = new Store<AppState>({
  name: 'xoay-config',
  defaults: {
    profiles: [],
    activeProfileId: null
  }
})

// ── Profile CRUD ─────────────────────────────────────────────────

export function listProfiles(): Profile[] {
  return store.get('profiles')
}

export function getProfile(id: string): Profile | null {
  const profiles = store.get('profiles')
  return profiles.find((p) => p.id === id) ?? null
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
    presetId: req.presetId,
    items,
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
  const filtered = profiles.filter((p) => p.id !== id)
  if (filtered.length === profiles.length) {
    throw new Error(`Profile not found: ${id}`)
  }
  store.set('profiles', filtered)

  // Clear active if deleted
  if (store.get('activeProfileId') === id) {
    store.set('activeProfileId', null)
  }
}

// ── Active Profile ───────────────────────────────────────────────

export function getActiveProfileId(): string | null {
  return store.get('activeProfileId')
}

export function setActiveProfileId(id: string | null): void {
  store.set('activeProfileId', id)
}

// ── Backups ──────────────────────────────────────────────────────

export { store }
