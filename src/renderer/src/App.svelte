<script lang="ts">
  import { onMount } from 'svelte'
  import type { Profile, ConfigItem, Preset, SwitchResult, SyncResult } from '../../shared/types'
  import * as ipc from './lib/ipc'
  import Sidebar from './lib/Sidebar.svelte'
  import ProfileDetail from './lib/ProfileDetail.svelte'
  import ConfigItemForm from './lib/ConfigItemForm.svelte'
  import CreateProfileDialog from './lib/CreateProfileDialog.svelte'
  import SwitchResultDialog from './lib/SwitchResultDialog.svelte'


  // ── State ──────────────────────────────────────────────────────
  let profiles = $state<Profile[]>([])
  let activeProfileId = $state<string | null>(null)
  let selectedProfileId = $state<string | null>(null)
  let presets = $state<Preset[]>([])
  let error = $state<string | null>(null)

  // Dialog states
  let showCreateDialog = $state(false)
  let showItemForm = $state(false)
  let editingItem = $state<ConfigItem | null>(null)
  let switchResult = $state<SwitchResult | null>(null)
  let switchProfileName = $state('')
  let loading = $state(false)

  const selectedProfile = $derived(profiles.find((p) => p.id === selectedProfileId) ?? null)

  // ── Data Loading ───────────────────────────────────────────────
  async function loadData(): Promise<void> {
    try {
      const [p, a, pr] = await Promise.all([
        ipc.listProfiles(),
        ipc.getActiveProfileId(),
        ipc.listPresets()
      ])
      profiles = p
      activeProfileId = a
      presets = pr

      // Select first profile if none selected
      if (!selectedProfileId && profiles.length > 0) {
        selectedProfileId = profiles[0].id
      }
      // Clear selection if profile was deleted
      if (selectedProfileId && !profiles.find((p) => p.id === selectedProfileId)) {
        selectedProfileId = profiles.length > 0 ? profiles[0].id : null
      }
      error = null
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }
  }

  onMount(() => {
    loadData()
    // Listen for profile switches from tray to refresh state
    const unsub = ipc.onProfileSwitched(() => { loadData() })
    return unsub
  })

  // ── Profile Actions ────────────────────────────────────────────
  async function handleCreateFromPreset(name: string, presetId: string): Promise<void> {
    try {
      const profile = await ipc.createProfile({ name, presetId })
      showCreateDialog = false
      await loadData()
      selectedProfileId = profile.id
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }
  }

  async function handleCreateBlank(name: string): Promise<void> {
    try {
      const profile = await ipc.createProfile({ name })
      showCreateDialog = false
      await loadData()
      selectedProfileId = profile.id
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }
  }

  async function handleImportCurrent(name: string, presetId?: string): Promise<void> {
    try {
      loading = true
      const profile = await ipc.importCurrentConfig(name, presetId)
      showCreateDialog = false
      await loadData()
      selectedProfileId = profile.id
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    } finally {
      loading = false
    }
  }

  async function handleDeleteProfile(): Promise<void> {
    if (!selectedProfile) return
    if (!confirm(`Delete profile "${selectedProfile.name}"?`)) return
    try {
      await ipc.deleteProfile(selectedProfile.id)
      selectedProfileId = null
      await loadData()
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }
  }

  async function handleSwitch(): Promise<void> {
    if (!selectedProfile) return
    try {
      loading = true
      switchProfileName = selectedProfile.name
      const result = await ipc.switchConfig(selectedProfile.id)
      switchResult = result
      await loadData()
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    } finally {
      loading = false
    }
  }

  async function handleRenameProfile(name: string): Promise<void> {
    if (!selectedProfile) return
    try {
      await ipc.updateProfile({ ...selectedProfile, name })
      await loadData()
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }
  }

  // ── Sync Actions ──────────────────────────────────────────────
  async function handleSyncProfile(): Promise<SyncResult[]> {
    if (!selectedProfile) return []
    try {
      const { results } = await ipc.syncProfile(selectedProfile.id)
      return results
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
      return []
    } finally {
      await loadData()
    }
  }

  // ── Config Item Actions ────────────────────────────────────────
  function handleAddItem(): void {
    editingItem = null
    showItemForm = true
  }

  function handleEditItem(item: ConfigItem): void {
    editingItem = item
    showItemForm = true
  }

  async function handleSaveItem(item: ConfigItem): Promise<void> {
    if (!selectedProfile) return
    try {
      const items = [...selectedProfile.items]
      const idx = items.findIndex((i) => i.id === item.id)
      if (idx >= 0) {
        items[idx] = item
      } else {
        items.push(item)
      }
      await ipc.updateProfile({ ...selectedProfile, items })
      showItemForm = false
      editingItem = null
      await loadData()
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }
  }

  async function handleDeleteItem(itemId: string): Promise<void> {
    if (!selectedProfile) return
    try {
      const items = selectedProfile.items.filter((i) => i.id !== itemId)
      await ipc.updateProfile({ ...selectedProfile, items })
      await loadData()
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }
  }

  async function handleToggleItem(itemId: string): Promise<void> {
    if (!selectedProfile) return
    try {
      const items = selectedProfile.items.map((i) =>
        i.id === itemId ? { ...i, enabled: !i.enabled } : i
      )
      await ipc.updateProfile({ ...selectedProfile, items })
      await loadData()
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }
  }

  // ── Import into existing profile ───────────────────────────────
  async function handleImportIntoProfile(): Promise<void> {
    if (!selectedProfile) return
    try {
      loading = true
      const items = await ipc.importPreview(selectedProfile.presetId ?? undefined)
      if (items.length === 0) {
        error = 'No config files found on disk'
        return
      }
      // Merge: replace matching items by type+target, add new ones
      const updated = [...selectedProfile.items]
      for (const imported of items) {
        const existingIdx = updated.findIndex((u) => {
          if (u.type !== imported.type) return false
          if (u.type === 'file-replace' && imported.type === 'file-replace') return u.targetPath === imported.targetPath
          if (u.type === 'env-var' && imported.type === 'env-var') return u.name === imported.name
          return false
        })
        if (existingIdx >= 0) {
          updated[existingIdx] = { ...updated[existingIdx], ...imported, id: updated[existingIdx].id }
        } else {
          updated.push(imported)
        }
      }
      await ipc.updateProfile({ ...selectedProfile, items: updated })
      await loadData()
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    } finally {
      loading = false
    }
  }
</script>

<div class="h-screen w-screen bg-surface-50-950 flex flex-col">
  <!-- Error banner -->
  {#if error}
    <div class="bg-error-500/20 border-b border-error-500/40 px-4 py-2 flex items-center justify-between">
      <span class="text-sm text-error-400">{error}</span>
      <button type="button" class="btn btn-sm preset-tonal" onclick={() => error = null}>Dismiss</button>
    </div>
  {/if}

  <!-- Loading overlay -->
  {#if loading}
    <div class="fixed inset-0 z-[100] bg-surface-950/40 flex items-center justify-center">
      <div class="card bg-surface-100-900 p-6 shadow-xl">
        <p class="text-sm animate-pulse">Processing...</p>
      </div>
    </div>
  {/if}

  <!-- Main layout -->
  <div class="flex flex-1 min-h-0">
    <!-- Sidebar -->
    <Sidebar
      {profiles}
      {activeProfileId}
      {selectedProfileId}
      onSelect={(id) => selectedProfileId = id}
      onCreateNew={() => showCreateDialog = true}
    />

    <!-- Detail -->
    <div class="flex-1 min-w-0">
      {#if selectedProfile}
        <ProfileDetail
          profile={selectedProfile}
          isActive={activeProfileId === selectedProfile.id}
          onSwitch={handleSwitch}
          onDelete={handleDeleteProfile}
          onAddItem={handleAddItem}
          onEditItem={handleEditItem}
          onDeleteItem={handleDeleteItem}
          onToggleItem={handleToggleItem}
          onImportCurrent={handleImportIntoProfile}
          onRenameProfile={handleRenameProfile}
          onSync={handleSyncProfile}
        />
      {:else}
        <div class="flex items-center justify-center h-full">
          <div class="text-center space-y-2 text-surface-400">
            <p class="text-lg">Xoay Config</p>
            <p class="text-sm">Select a profile or create a new one</p>
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>

<!-- Dialogs -->
<CreateProfileDialog
  open={showCreateDialog}
  {presets}
  onCreateFromPreset={handleCreateFromPreset}
  onCreateBlank={handleCreateBlank}
  onImportCurrent={handleImportCurrent}
  onCancel={() => showCreateDialog = false}
/>

<ConfigItemForm
  open={showItemForm}
  item={editingItem}
  onSave={handleSaveItem}
  onCancel={() => { showItemForm = false; editingItem = null }}
/>

<SwitchResultDialog
  result={switchResult}
  profileName={switchProfileName}
  onClose={() => switchResult = null}
/>
