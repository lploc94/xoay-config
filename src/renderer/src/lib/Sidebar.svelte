<script lang="ts">
  import { ChevronRightIcon, PlusIcon, UserIcon, FolderIcon, ImportIcon, DownloadIcon, Trash2Icon } from '@lucide/svelte'
  import type { Profile, Category, Preset, DisplayItem } from '../../../shared/types'

  interface Props {
    categories: Category[]
    profiles: Profile[]
    presets: Preset[]
    activeProfileIds: Record<string, string>
    selectedProfileId: string | null
    hookDisplayData: Record<string, DisplayItem[]>
    onSelect: (id: string) => void
    onCreateNew: (categoryId?: string) => void
    onAddCategory: (name: string) => void
    onDeleteCategory: (id: string) => void
    onImportPreset: () => void
    onExportPreset: (presetId: string) => void
  }

  let { categories, profiles, presets, activeProfileIds, selectedProfileId, hookDisplayData, onSelect, onCreateNew, onAddCategory, onDeleteCategory, onImportPreset, onExportPreset }: Props = $props()

  function profilesForCategory(categoryId: string): Profile[] {
    return profiles.filter((p) => p.categoryId === categoryId)
  }

  function activeProfileName(categoryId: string): string | undefined {
    const activeId = activeProfileIds[categoryId]
    if (!activeId) return undefined
    const profile = profiles.find((p) => p.id === activeId)
    return profile?.name
  }

  function presetForCategory(categoryId: string): Preset | undefined {
    const category = categories.find((c) => c.id === categoryId)
    if (!category) return undefined
    return presets.find((p) => p.categoryName === category.name)
  }

  /** Extract display items for a profile's quota card. */
  function profileDisplayItems(profileId: string): DisplayItem[] {
    return hookDisplayData[profileId] ?? []
  }

  /** Check if a profile has ONLY status-type items (no percentage, key-value, or text). */
  function isStatusOnly(items: DisplayItem[]): boolean {
    if (items.length === 0) return false
    return items.every((i) => i.type === 'status')
  }

  const STATUS_COLORS: Record<string, string> = {
    ok: 'bg-success-500',
    warning: 'bg-warning-500',
    error: 'bg-error-500'
  }

  const STATUS_TEXT_COLORS: Record<string, string> = {
    ok: 'text-success-500',
    warning: 'text-warning-500',
    error: 'text-error-500'
  }

  const STATUS_BAR_COLORS: Record<string, string> = {
    ok: 'bg-success-500',
    warning: 'bg-warning-500',
    error: 'bg-error-500'
  }

  let openCategories = $state(new Set<string>(categories.map(c => c.id)))

  function toggleCategory(id: string): void {
    const next = new Set(openCategories)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    openCategories = next
  }

  $effect(() => {
    const missing = categories.filter(c => !openCategories.has(c.id))
    if (missing.length > 0) {
      const next = new Set(openCategories)
      for (const cat of missing) next.add(cat.id)
      openCategories = next
    }
  })

  let addingCategory = $state(false)
  let newCategoryName = $state('')
  let deletingCategoryId = $state<string | null>(null)

  function confirmAddCategory(): void {
    const name = newCategoryName.trim()
    if (name) {
      onAddCategory(name)
    }
    addingCategory = false
    newCategoryName = ''
  }

  function cancelAddCategory(): void {
    addingCategory = false
    newCategoryName = ''
  }
</script>

<aside class="flex flex-col h-full border-r border-surface-200-800 w-[220px] bg-surface-50-950">
  <!-- Header -->
  <div class="px-3 py-3 border-b border-surface-200-800">
    <h2 class="text-xs font-bold text-surface-400 uppercase tracking-wide">Categories</h2>
  </div>

  <!-- Category list -->
  <div class="flex-1 overflow-y-auto py-1">
    {#each categories as category (category.id)}
      {@const catProfiles = profilesForCategory(category.id)}
      {@const activeName = activeProfileName(category.id)}
      <div class="px-2 py-1">
          <!-- Category header trigger -->
          {#if deletingCategoryId === category.id}
            <div class="flex items-center gap-1.5 px-2 py-1.5 text-sm">
              <span class="flex-1 truncate text-warning-500">Delete {category.name}?</span>
              <button
                type="button"
                class="btn btn-sm preset-filled-error-500 px-2 py-0.5 text-xs"
                onclick={() => { onDeleteCategory(category.id); deletingCategoryId = null }}
              >Yes</button>
              <button
                type="button"
                class="btn btn-sm preset-tonal px-2 py-0.5 text-xs"
                onclick={() => deletingCategoryId = null}
              >No</button>
            </div>
          {:else}
          <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
          <div
            class="btn hover:preset-tonal justify-start px-2 w-full text-left gap-1.5 group cursor-pointer"
            role="button"
            tabindex="0"
            onclick={() => toggleCategory(category.id)}
          >
            <ChevronRightIcon class="size-3.5 shrink-0 text-surface-400 transition-transform duration-200 {openCategories.has(category.id) ? 'rotate-90' : ''}" />
            <FolderIcon class="size-3.5 shrink-0 text-surface-400" />
            <div class="flex-1 min-w-0">
              <span class="text-sm font-medium truncate block">{category.name}</span>
              {#if activeName}
                <span class="text-[10px] text-surface-400 truncate block">{activeName}</span>
              {/if}
            </div>
            <button
              type="button"
              class="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-surface-300/20 transition-opacity"
              title="Add profile to {category.name}"
              onclick={(e) => { e.stopPropagation(); onCreateNew(category.id) }}
            >
              <PlusIcon class="size-3.5 text-surface-400" />
            </button>
            {#if !category.builtIn}
              <button
                type="button"
                class="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-surface-300/20 transition-opacity"
                title="Delete {category.name}"
                onclick={(e) => { e.stopPropagation(); deletingCategoryId = category.id }}
              >
                <Trash2Icon class="size-3.5 text-surface-400" />
              </button>
            {/if}
            {#if presetForCategory(category.id)}
              <button
                type="button"
                class="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-surface-300/20 transition-opacity"
                title="Export {category.name} preset"
                onclick={(e) => { e.stopPropagation(); const p = presetForCategory(category.id); if (p) onExportPreset(p.id) }}
              >
                <DownloadIcon class="size-3.5 text-surface-400" />
              </button>
            {/if}
          </div>
          {/if}

          <!-- Profiles under this category -->
          {#if openCategories.has(category.id)}
            <div class="ml-3 mt-0.5 space-y-0.5">
              {#each catProfiles as profile (profile.id)}
                {@const displayItems = profileDisplayItems(profile.id)}
                {@const hasDisplayData = displayItems.length > 0}
                {@const statusOnly = isStatusOnly(displayItems)}
                {@const percentageItem = displayItems.find((i) => i.type === 'percentage')}
                {@const kvItem = displayItems.find((i) => i.type === 'key-value')}
                {@const resetsItem = displayItems.find((i) => i.type === 'text' && i.label === 'Resets In')}
                {@const statusItem = displayItems.find((i) => i.type === 'status')}
                {@const isActive = activeProfileIds[category.id] === profile.id}
                <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
                <div
                  class="rounded-md cursor-pointer transition-colors {selectedProfileId === profile.id ? 'preset-tonal' : 'hover:preset-tonal'}"
                  role="button"
                  tabindex="0"
                  onclick={() => onSelect(profile.id)}
                >
                  <!-- Profile name row -->
                  <div class="flex items-center pl-4 pr-2 py-1.5 gap-2">
                    <UserIcon class="size-3.5 shrink-0 text-surface-400" />
                    <span class="flex-1 truncate text-sm">{profile.name}</span>
                    {#if isActive}
                      <span class="size-2 rounded-full bg-success-500 shrink-0" title="Active"></span>
                    {/if}
                  </div>

                  {#if hasDisplayData && !statusOnly}
                    <!-- Expanded quota card -->
                    <div class="pl-8 pr-3 pb-2 space-y-1">
                      {#if percentageItem}
                        <!-- Percentage bar -->
                        {@const pct = typeof percentageItem.value === 'number' ? percentageItem.value : 0}
                        {@const max = percentageItem.max ?? 100}
                        {@const barPct = Math.min(100, Math.max(0, (pct / max) * 100))}
                        {@const barColor = STATUS_BAR_COLORS[percentageItem.status ?? 'ok']}
                        <div class="w-full h-1.5 rounded-full bg-surface-200-800 overflow-hidden" title="{percentageItem.label}: {pct}%">
                          <div class="h-full rounded-full transition-all duration-300 {barColor}" style="width: {barPct}%"></div>
                        </div>
                      {/if}

                      {#if kvItem?.entries}
                        <!-- Usage line -->
                        <p class="text-[10px] text-surface-400 truncate">
                          {#each Object.entries(kvItem.entries) as [key, val], i}
                            {#if i > 0}<span class="mx-0.5">·</span>{/if}
                            <span>{key}: {val}</span>
                          {/each}
                        </p>
                      {/if}

                      {#if resetsItem}
                        <!-- Resets In -->
                        <p class="text-[10px] text-surface-400 truncate">
                          Resets in {resetsItem.value ?? '—'}
                        </p>
                      {/if}
                    </div>
                  {:else if hasDisplayData && statusOnly && statusItem}
                    <!-- Status-only compact line -->
                    <div class="pl-8 pr-3 pb-2">
                      <div class="flex items-center gap-1.5">
                        <span class="size-1.5 rounded-full shrink-0 {STATUS_COLORS[statusItem.status ?? 'ok']}"></span>
                        <span class="text-[10px] truncate {STATUS_TEXT_COLORS[statusItem.status ?? 'ok']}">{statusItem.value}</span>
                      </div>
                    </div>
                  {/if}
                </div>
              {/each}
              {#if catProfiles.length === 0}
                <p class="text-[11px] text-surface-400 px-4 py-2">No profiles</p>
              {/if}
            </div>
          {/if}
        </div>
    {/each}

    {#if addingCategory}
      <div class="px-2 py-1">
        <div class="flex items-center gap-1.5 px-2">
          <FolderIcon class="size-3.5 shrink-0 text-surface-400" />
          <!-- svelte-ignore a11y_autofocus -->
          <input
            type="text"
            class="input text-sm px-2 py-1 flex-1 min-w-0"
            placeholder="Category name"
            bind:value={newCategoryName}
            autofocus
            onkeydown={(e: KeyboardEvent) => {
              if (e.key === 'Enter') confirmAddCategory()
              if (e.key === 'Escape') cancelAddCategory()
            }}
            onblur={() => confirmAddCategory()}
          />
        </div>
      </div>
    {/if}

    {#if categories.length === 0}
      <p class="text-xs text-surface-400 px-3 py-4 text-center">No categories yet</p>
    {/if}
  </div>

  <!-- Footer: Add Category + Import Preset -->
  <div class="border-t border-surface-200-800 p-2 space-y-0.5">
    <button
      type="button"
      class="btn hover:preset-tonal justify-start px-3 w-full gap-2"
      onclick={onImportPreset}
    >
      <ImportIcon class="size-4" />
      <span class="text-sm">Import Preset</span>
    </button>
    {#if !addingCategory}
      <button
        type="button"
        class="btn hover:preset-tonal justify-start px-3 w-full gap-2"
        onclick={() => addingCategory = true}
      >
        <PlusIcon class="size-4" />
        <span class="text-sm">New Category</span>
      </button>
    {/if}
  </div>
</aside>
