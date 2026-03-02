<script lang="ts">
  import {
    PlayIcon, TrashIcon, PencilIcon, PlusIcon, DownloadIcon,
    FileIcon, VariableIcon,
    CheckIcon, XIcon,
    ZapIcon, ClockIcon
  } from '@lucide/svelte'
  import type { Profile, ConfigItem, ProfileHook, DisplayItem } from '../../../shared/types'
  import DOMPurify from 'dompurify'

  interface Props {
    profile: Profile
    isActive: boolean
    hookDisplayData: DisplayItem[]
    lastHookRunAt: number | null
    hookNotification: { message: string; hookLabel: string } | null
    onSwitch: () => void
    onDelete: () => void
    onAddItem: () => void
    onEditItem: (item: ConfigItem) => void
    onDeleteItem: (itemId: string) => void
    onToggleItem: (itemId: string) => void
    onImportCurrent: () => void
    onRenameProfile: (name: string) => void
    onAddHook: () => void
    onEditHook: (hook: ProfileHook) => void
    onDeleteHook: (hookId: string) => void
    onToggleHook: (hookId: string) => void
    onDismissHookNotification: () => void
  }

  let {
    profile, isActive, hookDisplayData, lastHookRunAt, hookNotification,
    onSwitch, onDelete, onAddItem,
    onEditItem, onDeleteItem, onToggleItem, onImportCurrent,
    onRenameProfile,
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
    return VariableIcon
  }

  function typeLabel(type: ConfigItem['type']): string {
    if (type === 'file-replace') return 'File Replace'
    return 'Env Variable'
  }

  function itemSummary(item: ConfigItem): string {
    if (item.type === 'file-replace') return item.targetPath
    return `${item.name} = ${item.value ? item.value.substring(0, 20) + (item.value.length > 20 ? '...' : '') : '(empty)'}`
  }

  // Group items by type
  const groupedItems = $derived.by(() => {
    const groups: Record<ConfigItem['type'], ConfigItem[]> = {
      'file-replace': [],
      'env-var': []
    }
    for (const item of profile.items) {
      groups[item.type].push(item)
    }
    return groups
  })

  const switching = $state({ loading: false })

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

  function isBuiltinHook(hook: ProfileHook): boolean {
    return hook.builtIn === true
  }

  function displayStatusColor(status?: 'ok' | 'warning' | 'error'): string {
    if (status === 'warning') return 'text-warning-400'
    if (status === 'error') return 'text-error-400'
    return 'text-success-400'
  }

  function displayStatusBorder(status?: 'ok' | 'warning' | 'error'): string {
    if (status === 'warning') return 'border-warning-500/40'
    if (status === 'error') return 'border-error-500/40'
    return 'border-success-500/40'
  }

  function displayStatusDot(status?: 'ok' | 'warning' | 'error'): string {
    if (status === 'warning') return 'bg-warning-500'
    if (status === 'error') return 'bg-error-500'
    return 'bg-success-500'
  }

  function percentageWidth(value: string | number | null, max?: number): number {
    const num = typeof value === 'number' ? value : parseFloat(String(value ?? '0'))
    const total = max ?? 100
    if (total <= 0) return 0
    return Math.min(100, Math.max(0, (num / total) * 100))
  }

  function relativeTime(epochMs: number): string {
    const seconds = Math.floor((Date.now() - epochMs) / 1000)
    if (seconds < 10) return 'just now'
    if (seconds < 60) return `${seconds}s ago`
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    return `${hours}h ago`
  }

  let relativeTimeStr = $state('')
  $effect(() => {
    if (!lastHookRunAt) return
    // Capture the value for the interval closure
    const ts = lastHookRunAt
    const update = () => { relativeTimeStr = relativeTime(ts) }
    update()
    const interval = setInterval(update, 10_000)
    return () => clearInterval(interval)
  })
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
    <!-- Status Card -->
    {#if hookDisplayData.length > 0}
      <div class="rounded-lg border border-surface-200-800 bg-surface-100-900 overflow-hidden">
        <div class="grid gap-px bg-surface-200-800" style="grid-template-columns: repeat(3, 1fr);">
          {#each hookDisplayData as item}
            <div class="px-4 py-3 bg-surface-50-950 border-l-2 {displayStatusBorder(item.status)}" style="{item.span === 'full' ? 'grid-column: 1 / -1;' : item.span === 2 ? 'grid-column: span 2;' : item.span === 3 ? 'grid-column: span 3;' : ''}">
              {#if item.type === 'text'}
                <p class="text-lg font-bold {displayStatusColor(item.status)}">{item.value ?? ''}</p>
                <p class="text-xs text-surface-400 mt-0.5">{item.label}</p>
              {:else if item.type === 'number'}
                <p class="text-2xl font-bold {displayStatusColor(item.status)}">{item.value ?? 0}</p>
                <p class="text-xs text-surface-400 mt-0.5">{item.label}</p>
              {:else if item.type === 'percentage'}
                {@const pct = percentageWidth(item.value, item.max)}
                <div class="flex items-center justify-between mb-1">
                  <p class="text-xs text-surface-400">{item.label}</p>
                  <p class="text-xs font-medium {displayStatusColor(item.status)}">{Math.round(pct)}%</p>
                </div>
                <div class="w-full h-2 rounded-full bg-surface-300/30 overflow-hidden">
                  <div class="h-full rounded-full transition-all {item.status === 'error' ? 'bg-error-500' : item.status === 'warning' ? 'bg-warning-500' : 'bg-success-500'}" style="width: {pct}%"></div>
                </div>
              {:else if item.type === 'status'}
                <div class="flex items-center gap-2">
                  <span class="size-2.5 rounded-full shrink-0 {displayStatusDot(item.status)}"></span>
                  <p class="text-sm font-medium">{item.value ?? ''}</p>
                </div>
                <p class="text-xs text-surface-400 mt-0.5 pl-[18px]">{item.label}</p>
              {:else if item.type === 'key-value'}
                <p class="text-xs text-surface-400 mb-1.5">{item.label}</p>
                {#if item.entries}
                  <div class="space-y-0.5">
                    {#each Object.entries(item.entries) as [k, v]}
                      <div class="flex items-center justify-between text-xs">
                        <span class="text-surface-400">{k}</span>
                        <span class="font-medium">{v}</span>
                      </div>
                    {/each}
                  </div>
                {/if}
              {:else if item.type === 'html'}
                <p class="text-xs text-surface-400 mb-1">{item.label}</p>
                <div class="text-sm">
                  {@html DOMPurify.sanitize(String(item.value ?? ''))}
                </div>
              {/if}
            </div>
          {/each}
        </div>
        {#if lastHookRunAt}
          <div class="px-4 py-1.5 border-t border-surface-200-800 flex items-center gap-1 text-xs text-surface-400">
            <ClockIcon class="size-3" />
            <span>Updated {relativeTimeStr}</span>
          </div>
        {/if}
      </div>
    {/if}

    {#each (['file-replace', 'env-var'] as const) as type}
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
                    <p class="text-sm font-medium truncate">
                      {hook.label}
                      {#if isBuiltinHook(hook)}
                        <span class="ml-1 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-surface-300/50 text-surface-500 dark:bg-surface-700/50 dark:text-surface-400" title="This is a built-in hook that ships with the app">Built-in</span>
                      {/if}
                    </p>
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
                    {#if !isBuiltinHook(hook)}
                      <button type="button" class="btn-icon btn-icon-sm hover:preset-tonal text-error-500" onclick={() => onDeleteHook(hook.id)} title="Delete">
                        <TrashIcon class="size-3" />
                      </button>
                    {/if}
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
