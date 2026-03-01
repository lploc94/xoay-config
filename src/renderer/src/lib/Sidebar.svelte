<script lang="ts">
  import { ChevronRightIcon, PlusIcon, UserIcon, FolderIcon, ImportIcon, DownloadIcon, Trash2Icon } from '@lucide/svelte'
  import { Collapsible } from '@skeletonlabs/skeleton-svelte'
  import type { Profile, Category, Preset, HookDisplayValue } from '../../../shared/types'

  interface Props {
    categories: Category[]
    profiles: Profile[]
    presets: Preset[]
    activeProfileIds: Record<string, string>
    selectedProfileId: string | null
    hookDisplayData: Record<string, Record<string, HookDisplayValue>>
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

  /** Get the primary (first) display value for a profile, only if active. */
  function primaryBadge(profileId: string, categoryId: string): HookDisplayValue | undefined {
    if (activeProfileIds[categoryId] !== profileId) return undefined
    const data = hookDisplayData[profileId]
    if (!data) return undefined
    const entries = Object.values(data)
    return entries.length > 0 ? entries[0] : undefined
  }

  const STATUS_COLORS: Record<string, string> = {
    ok: 'bg-success-500',
    warning: 'bg-warning-500',
    error: 'bg-error-500'
  }

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
      <Collapsible defaultOpen={true}>
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
          <Collapsible.Trigger class="btn hover:preset-tonal justify-start px-2 w-full text-left gap-1.5 group">
            <ChevronRightIcon class="size-3.5 shrink-0 text-surface-400 transition-transform duration-200 group-data-[state=open]:rotate-90" />
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
          </Collapsible.Trigger>
          {/if}

          <!-- Profiles under this category -->
          <Collapsible.Content>
            <div class="ml-3 mt-0.5 space-y-0.5">
              {#each catProfiles as profile (profile.id)}
                {@const badge = primaryBadge(profile.id, category.id)}
                <button
                  type="button"
                  class="btn hover:preset-tonal justify-start pl-4 pr-2 w-full text-left gap-2 {selectedProfileId === profile.id ? 'preset-tonal' : ''}"
                  onclick={() => onSelect(profile.id)}
                >
                  <UserIcon class="size-3.5 shrink-0 text-surface-400" />
                  <span class="flex-1 truncate text-sm">{profile.name}</span>
                  {#if badge?.value}
                    <span
                      class="text-[10px] font-medium px-1.5 py-0.5 rounded-full text-white shrink-0 {STATUS_COLORS[badge.status ?? 'ok']}"
                      title={badge.label ?? ''}
                    >{badge.value}</span>
                  {/if}
                  {#if activeProfileIds[category.id] === profile.id}
                    <span class="size-2 rounded-full bg-success-500 shrink-0" title="Active"></span>
                  {/if}
                </button>
              {/each}
              {#if catProfiles.length === 0}
                <p class="text-[11px] text-surface-400 px-4 py-2">No profiles</p>
              {/if}
            </div>
          </Collapsible.Content>
        </div>
      </Collapsible>
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
