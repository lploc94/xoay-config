<script lang="ts">
  import {
    PlayIcon, TrashIcon, PencilIcon, PlusIcon, DownloadIcon,
    FileIcon, VariableIcon, TerminalIcon,
    CheckIcon, XIcon, RefreshCwIcon, AnchorIcon,
    ZapIcon
  } from '@lucide/svelte'
  import type { Profile, ConfigItem, ProfileHook, SyncResult, HookDisplayValue } from '../../../shared/types'

  interface Props {
    profile: Profile
    isActive: boolean
    hookDisplayData: Record<string, HookDisplayValue>
    hookNotification: { message: string; hookLabel: string } | null
    onSwitch: () => void
    onDelete: () => void
    onAddItem: () => void
    onEditItem: (item: ConfigItem) => void
    onDeleteItem: (itemId: string) => void
    onToggleItem: (itemId: string) => void
    onImportCurrent: () => void
    onRenameProfile: (name: string) => void
    onSync: () => Promise<SyncResult[]>
    onAddHook: () => void
    onEditHook: (hook: ProfileHook) => void
    onDeleteHook: (hookId: string) => void
    onToggleHook: (hookId: string) => void
    onDismissHookNotification: () => void
  }

  let {
    profile, isActive, hookDisplayData, hookNotification,
    onSwitch, onDelete, onAddItem,
    onEditItem, onDeleteItem, onToggleItem, onImportCurrent,
    onRenameProfile, onSync,
    onAddHook, onEditHook, onDeleteHook, onToggleHook,
    onDismissHookNotification
  }: Props = $props()

  let editing = $state(false)
  let editName = $state('')

  function startRename(): void {
    editName = profile.name
    editing = true
  }

  function finishRename(): void {
    if (editName.trim() && editName.trim() !== profile.name) {
      onRenameProfile(editName.trim())
    }
    editing = false
  }

  function typeIcon(type: ConfigItem['type']) {
    if (type === 'file-replace') return FileIcon
    if (type === 'env-var') return VariableIcon
    return TerminalIcon
  }

  function typeLabel(type: ConfigItem['type']): string {
    if (type === 'file-replace') return 'File Replace'
    if (type === 'env-var') return 'Env Variable'
    return 'Run Command'
  }

  function itemSummary(item: ConfigItem): string {
    if (item.type === 'file-replace') return item.targetPath
    if (item.type === 'env-var') return `${item.name} = ${item.value ? item.value.substring(0, 20) + (item.value.length > 20 ? '...' : '') : '(empty)'}`
    return item.command
  }

  // Group items by type
  const groupedItems = $derived.by(() => {
    const groups: Record<ConfigItem['type'], ConfigItem[]> = {
      'file-replace': [],
      'env-var': [],
      'run-command': []
    }
    for (const item of profile.items) {
      groups[item.type].push(item)
    }
    return groups
  })

  const switching = $state({ loading: false })

  let syncing = $state(false)
  let syncResults = $state<SyncResult[] | null>(null)
  let syncError = $state<string | null>(null)

  async function handleSync(): Promise<void> {
    syncing = true
    syncResults = null
    syncError = null
    try {
      syncResults = await onSync()
    } catch (e) {
      syncError = e instanceof Error ? e.message : String(e)
    } finally {
      syncing = false
    }
  }

  function syncResultMessage(r: SyncResult): string {
    if (r.synced) return 'Synced'
    if (r.reason === 'anchor-mismatch') return 'Skipped: different account'
    if (r.reason === 'no-change') return 'No change'
    if (r.reason === 'file-not-found') return 'File not found'
    if (r.reason === 'error') return r.error ?? 'Error'
    return 'Skipped'
  }

  function hasAnchor(item: ConfigItem): boolean {
    return item.type !== 'run-command' && !!item.anchor
  }

  // Hook helpers
  function hookTypeLabel(type: ProfileHook['type']): string {
    switch (type) {
      case 'pre-switch-in': return 'Pre In'
      case 'post-switch-in': return 'Post In'
      case 'pre-switch-out': return 'Pre Out'
      case 'post-switch-out': return 'Post Out'
      case 'cron': return 'Cron'
    }
  }

  const groupedHooks = $derived.by(() => {
    const groups: Record<ProfileHook['type'], ProfileHook[]> = {
      'pre-switch-in': [],
      'post-switch-in': [],
      'pre-switch-out': [],
      'post-switch-out': [],
      'cron': []
    }
    for (const hook of profile.hooks) {
      groups[hook.type].push(hook)
    }
    return groups
  })

  const hookDisplayEntries = $derived(Object.entries(hookDisplayData))

  function displayStatusColor(status?: 'ok' | 'warning' | 'error'): string {
    if (status === 'warning') return 'bg-warning-500/20 text-warning-400 border-warning-500/30'
    if (status === 'error') return 'bg-error-500/20 text-error-400 border-error-500/30'
    return 'bg-success-500/20 text-success-400 border-success-500/30'
  }
</script>

<div class="flex flex-col h-full">
  <!-- Header -->
  <div class="flex items-center justify-between px-5 py-3 border-b border-surface-200-800">
    <div class="flex items-center gap-2 min-w-0">
      {#if editing}
        <form onsubmit={(e) => { e.preventDefault(); finishRename() }} class="flex items-center gap-2">
          <!-- svelte-ignore a11y_autofocus -->
          <input class="input input-sm w-48" type="text" bind:value={editName} autofocus />
          <button type="submit" class="btn-icon btn-icon-sm hover:preset-tonal"><CheckIcon class="size-4" /></button>
          <button type="button" class="btn-icon btn-icon-sm hover:preset-tonal" onclick={() => editing = false}><XIcon class="size-4" /></button>
        </form>
      {:else}
        <h2 class="text-xl font-bold truncate">{profile.name}</h2>
        {#if isActive}
          <span class="badge preset-filled-success-500 text-xs">Active</span>
        {/if}
        {#if profile.presetId}
          <span class="badge preset-tonal text-xs">{profile.presetId}</span>
        {/if}
        <button type="button" class="btn-icon btn-icon-sm hover:preset-tonal" onclick={startRename} title="Rename">
          <PencilIcon class="size-3" />
        </button>
      {/if}
    </div>

    <div class="flex items-center gap-1">
      <button type="button" class="btn btn-sm preset-filled-primary-500" onclick={onSwitch} title="Switch to this profile">
        <PlayIcon class="size-4" /> Switch
      </button>
      <button type="button" class="btn btn-sm preset-tonal" onclick={handleSync} disabled={syncing} title="Sync from disk">
        <RefreshCwIcon class="size-4 {syncing ? 'animate-spin' : ''}" /> Sync
      </button>
      <button type="button" class="btn btn-sm preset-tonal" onclick={onImportCurrent} title="Import current config">
        <DownloadIcon class="size-4" /> Import
      </button>
      <button type="button" class="btn btn-sm preset-tonal text-error-500" onclick={onDelete} title="Delete profile">
        <TrashIcon class="size-4" />
      </button>
    </div>
  </div>

  <!-- Config Items -->
  <div class="flex-1 overflow-y-auto p-5 space-y-4">
    <!-- Sync Results Banner -->
    {#if syncResults}
      {@const syncedCount = syncResults.filter(r => r.synced).length}
      <div class="rounded p-3 space-y-2 {syncedCount > 0 ? 'bg-success-500/10 border border-success-500/30' : 'bg-surface-200-800'}">
        <div class="flex items-center justify-between">
          <span class="text-sm font-medium">
            {#if syncedCount > 0}
              {syncedCount} item{syncedCount > 1 ? 's' : ''} synced
            {:else}
              No items synced
            {/if}
          </span>
          <button type="button" class="btn-icon btn-icon-sm hover:preset-tonal" onclick={() => syncResults = null} title="Dismiss">
            <XIcon class="size-3" />
          </button>
        </div>
        {#each syncResults as r}
          {@const item = profile.items.find(i => i.id === r.itemId)}
          <div class="flex items-center gap-2 text-xs">
            {#if r.synced}
              <CheckIcon class="size-3 text-success-500 shrink-0" />
            {:else}
              <XIcon class="size-3 text-surface-400 shrink-0" />
            {/if}
            <span class="truncate">{item?.label ?? r.itemId}</span>
            <span class="text-surface-400 ml-auto shrink-0">{syncResultMessage(r)}</span>
          </div>
        {/each}
      </div>
    {/if}

    {#if syncError}
      <div class="rounded p-3 bg-error-500/10 border border-error-500/30 flex items-center justify-between">
        <span class="text-sm text-error-400">{syncError}</span>
        <button type="button" class="btn-icon btn-icon-sm hover:preset-tonal" onclick={() => syncError = null} title="Dismiss">
          <XIcon class="size-3" />
        </button>
      </div>
    {/if}

    {#each (['file-replace', 'env-var', 'run-command'] as const) as type}
      {@const items = groupedItems[type]}
      {#if items.length > 0}
        {@const Icon = typeIcon(type)}
        <div>
          <div class="flex items-center gap-2 mb-2">
            <Icon class="size-4 text-surface-400" />
            <h3 class="text-sm font-semibold text-surface-400 uppercase tracking-wide">{typeLabel(type)}</h3>
            <span class="badge preset-tonal text-xs">{items.length}</span>
          </div>
          <div class="space-y-1">
            {#each items as item (item.id)}
              <div class="flex items-center gap-2 px-3 py-2 rounded bg-surface-200-800 group {!item.enabled ? 'opacity-50' : ''}">
                <span class="flex-1 min-w-0">
                  <p class="text-sm font-medium truncate">
                    {item.label}
                    {#if hasAnchor(item)}
                      <AnchorIcon class="size-3 inline-block ml-1 text-surface-400" title="Has anchor" />
                    {/if}
                  </p>
                  <p class="text-xs text-surface-400 truncate">{itemSummary(item)}</p>
                </span>
                <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button type="button" class="btn-icon btn-icon-sm hover:preset-tonal" onclick={() => onToggleItem(item.id)} title={item.enabled ? 'Disable' : 'Enable'}>
                    {#if item.enabled}
                      <CheckIcon class="size-3 text-success-500" />
                    {:else}
                      <XIcon class="size-3 text-surface-400" />
                    {/if}
                  </button>
                  <button type="button" class="btn-icon btn-icon-sm hover:preset-tonal" onclick={() => onEditItem(item)} title="Edit">
                    <PencilIcon class="size-3" />
                  </button>
                  <button type="button" class="btn-icon btn-icon-sm hover:preset-tonal text-error-500" onclick={() => onDeleteItem(item.id)} title="Delete">
                    <TrashIcon class="size-3" />
                  </button>
                </div>
              </div>
            {/each}
          </div>
        </div>
      {/if}
    {/each}

    {#if profile.items.length === 0}
      <div class="text-center py-12 text-surface-400">
        <p class="text-sm">No config items yet</p>
        <p class="text-xs mt-1">Add items to define what this profile switches</p>
      </div>
    {/if}

    <!-- Add Item Button -->
    <button type="button" class="btn preset-tonal w-full" onclick={onAddItem}>
      <PlusIcon class="size-4" /> Add Config Item
    </button>

    <!-- Hook Display Data -->
    {#if hookDisplayEntries.length > 0}
      <div class="flex flex-wrap gap-2 pt-2">
        {#each hookDisplayEntries as [key, val]}
          <span class="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border {displayStatusColor(val.status)}">
            <span class="font-medium">{val.label ?? key}:</span>
            <span>{val.value}</span>
          </span>
        {/each}
      </div>
    {/if}

    <!-- Hook Notification Banner -->
    {#if hookNotification}
      <div class="rounded p-3 bg-warning-500/10 border border-warning-500/30 flex items-center justify-between">
        <span class="text-sm text-warning-400">
          <span class="font-medium">{hookNotification.hookLabel}:</span> {hookNotification.message}
        </span>
        <button type="button" class="btn-icon btn-icon-sm hover:preset-tonal" onclick={onDismissHookNotification} title="Dismiss">
          <XIcon class="size-3" />
        </button>
      </div>
    {/if}

    <!-- Hooks Section -->
    <div class="pt-4 border-t border-surface-200-800">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2">
          <ZapIcon class="size-4 text-surface-400" />
          <h3 class="text-sm font-semibold text-surface-400 uppercase tracking-wide">Hooks</h3>
          {#if profile.hooks.length > 0}
            <span class="badge preset-tonal text-xs">{profile.hooks.length}</span>
          {/if}
        </div>
      </div>

      {#each (['pre-switch-in', 'post-switch-in', 'pre-switch-out', 'post-switch-out', 'cron'] as const) as type}
        {@const hooks = groupedHooks[type]}
        {#if hooks.length > 0}
          <div class="mb-3">
            <div class="flex items-center gap-2 mb-1">
              <span class="badge preset-tonal text-xs">{hookTypeLabel(type)}</span>
            </div>
            <div class="space-y-1">
              {#each hooks as hook (hook.id)}
                <div class="flex items-center gap-2 px-3 py-2 rounded bg-surface-200-800 group {!hook.enabled ? 'opacity-50' : ''}">
                  <span class="flex-1 min-w-0">
                    <p class="text-sm font-medium truncate">{hook.label}</p>
                    <p class="text-xs text-surface-400 truncate">{hook.scriptPath}</p>
                  </span>
                  <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button type="button" class="btn-icon btn-icon-sm hover:preset-tonal" onclick={() => onToggleHook(hook.id)} title={hook.enabled ? 'Disable' : 'Enable'}>
                      {#if hook.enabled}
                        <CheckIcon class="size-3 text-success-500" />
                      {:else}
                        <XIcon class="size-3 text-surface-400" />
                      {/if}
                    </button>
                    <button type="button" class="btn-icon btn-icon-sm hover:preset-tonal" onclick={() => onEditHook(hook)} title="Edit">
                      <PencilIcon class="size-3" />
                    </button>
                    <button type="button" class="btn-icon btn-icon-sm hover:preset-tonal text-error-500" onclick={() => onDeleteHook(hook.id)} title="Delete">
                      <TrashIcon class="size-3" />
                    </button>
                  </div>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      {/each}

      {#if profile.hooks.length === 0}
        <p class="text-xs text-surface-400 text-center py-3">No hooks configured</p>
      {/if}

      <button type="button" class="btn preset-tonal w-full" onclick={onAddHook}>
        <PlusIcon class="size-4" /> Add Hook
      </button>
    </div>
  </div>
</div>
