<script lang="ts">
  import { PlusIcon, UserIcon } from '@lucide/svelte'
  import { Navigation } from '@skeletonlabs/skeleton-svelte'
  import type { Profile } from '../../../shared/types'

  interface Props {
    profiles: Profile[]
    activeProfileId: string | null
    selectedProfileId: string | null
    onSelect: (id: string) => void
    onCreateNew: () => void
  }

  let { profiles, activeProfileId, selectedProfileId, onSelect, onCreateNew }: Props = $props()
</script>

<Navigation layout="sidebar" class="grid grid-rows-[auto_1fr_auto] gap-2 h-full border-r border-surface-200-800 w-[200px]">
  <Navigation.Header>
    <div class="px-3 py-2">
      <h2 class="text-sm font-bold text-surface-300 uppercase tracking-wide">Profiles</h2>
    </div>
  </Navigation.Header>
  <Navigation.Content>
    <Navigation.Menu>
      {#each profiles as profile (profile.id)}
        <button
          type="button"
          class="btn hover:preset-tonal justify-start px-3 w-full text-left gap-2 {selectedProfileId === profile.id ? 'preset-tonal' : ''}"
          onclick={() => onSelect(profile.id)}
        >
          <UserIcon class="size-4 shrink-0" />
          <span class="flex-1 truncate text-sm">{profile.name}</span>
          {#if activeProfileId === profile.id}
            <span class="size-2 rounded-full bg-success-500 shrink-0" title="Active"></span>
          {/if}
        </button>
      {/each}
      {#if profiles.length === 0}
        <p class="text-xs text-surface-400 px-3 py-4 text-center">No profiles yet</p>
      {/if}
    </Navigation.Menu>
  </Navigation.Content>
  <Navigation.Footer>
    <button
      type="button"
      class="btn hover:preset-tonal justify-start px-3 w-full gap-2"
      onclick={onCreateNew}
    >
      <PlusIcon class="size-4" />
      <span class="text-sm">New Profile</span>
    </button>
  </Navigation.Footer>
</Navigation>
