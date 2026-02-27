<script lang="ts">
  import {
    PlayIcon, TrashIcon, PencilIcon, PlusIcon, DownloadIcon,
    FileIcon, VariableIcon, TerminalIcon,
    CheckIcon, XIcon
  } from '@lucide/svelte'
  import type { Profile, ConfigItem } from '../../../shared/types'

  interface Props {
    profile: Profile
    isActive: boolean
    onSwitch: () => void
    onDelete: () => void
    onAddItem: () => void
    onEditItem: (item: ConfigItem) => void
    onDeleteItem: (itemId: string) => void
    onToggleItem: (itemId: string) => void
    onImportCurrent: () => void
    onRenameProfile: (name: string) => void
  }

  let {
    profile, isActive, onSwitch, onDelete, onAddItem,
    onEditItem, onDeleteItem, onToggleItem, onImportCurrent,
    onRenameProfile
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
                  <p class="text-sm font-medium truncate">{item.label}</p>
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
  </div>
</div>
