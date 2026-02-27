<script lang="ts">
  import { XIcon } from '@lucide/svelte'
  import { Dialog, Portal } from '@skeletonlabs/skeleton-svelte'
  import type { Preset } from '../../../shared/types'

  interface Props {
    open: boolean
    presets: Preset[]
    onCreateFromPreset: (name: string, presetId: string) => void
    onCreateBlank: (name: string) => void
    onImportCurrent: (name: string, presetId?: string) => void
    onCancel: () => void
  }

  let { open, presets, onCreateFromPreset, onCreateBlank, onImportCurrent, onCancel }: Props = $props()

  let name = $state('')
  let selectedPresetId = $state('')
  let mode = $state<'preset' | 'blank' | 'import'>('preset')

  $effect(() => {
    if (open) {
      name = ''
      selectedPresetId = presets.length > 0 ? presets[0].id : ''
      mode = 'preset'
    }
  })

  function handleSubmit(): void {
    if (!name.trim()) return
    if (mode === 'preset' && selectedPresetId) {
      onCreateFromPreset(name.trim(), selectedPresetId)
    } else if (mode === 'import') {
      onImportCurrent(name.trim(), selectedPresetId || undefined)
    } else {
      onCreateBlank(name.trim())
    }
  }

  const animation =
    'transition transition-discrete opacity-0 translate-y-[100px] starting:data-[state=open]:opacity-0 starting:data-[state=open]:translate-y-[100px] data-[state=open]:opacity-100 data-[state=open]:translate-y-0'
</script>

{#if open}
<Dialog open={true}>
  <Portal>
    <Dialog.Backdrop class="fixed inset-0 z-50 bg-surface-950/60" />
    <Dialog.Positioner class="fixed inset-0 z-50 flex justify-center items-center p-4">
      <Dialog.Content class="card bg-surface-100-900 w-full max-w-md p-5 space-y-4 shadow-xl {animation}">
        <header class="flex justify-between items-center">
          <Dialog.Title class="text-lg font-bold">Create Profile</Dialog.Title>
          <button type="button" class="btn-icon hover:preset-tonal" onclick={onCancel}>
            <XIcon class="size-4" />
          </button>
        </header>

        <form class="space-y-4" onsubmit={(e) => { e.preventDefault(); handleSubmit() }}>
          <div>
            <label for="profile-name" class="label text-sm font-medium mb-1">Profile Name</label>
            <input id="profile-name" class="input" type="text" bind:value={name} placeholder="My Account" required />
          </div>

          <!-- Mode selector -->
          <div>
            <span class="label text-sm font-medium mb-2">Create Method</span>
            <div class="flex gap-2">
              <button type="button" class="btn text-sm flex-1 {mode === 'preset' ? 'preset-filled' : 'preset-tonal'}" onclick={() => mode = 'preset'}>
                From Preset
              </button>
              <button type="button" class="btn text-sm flex-1 {mode === 'import' ? 'preset-filled' : 'preset-tonal'}" onclick={() => mode = 'import'}>
                Import Current
              </button>
              <button type="button" class="btn text-sm flex-1 {mode === 'blank' ? 'preset-filled' : 'preset-tonal'}" onclick={() => mode = 'blank'}>
                Blank
              </button>
            </div>
          </div>

          <!-- Preset selector -->
          {#if mode === 'preset' || mode === 'import'}
          <div>
            <label for="preset-select" class="label text-sm font-medium mb-1">
              {mode === 'preset' ? 'Preset' : 'Import from Preset'}
            </label>
            <select id="preset-select" class="select" bind:value={selectedPresetId}>
              {#if mode === 'import'}
                <option value="">Auto-detect</option>
              {/if}
              {#each presets as preset}
                <option value={preset.id}>{preset.name} — {preset.description}</option>
              {/each}
            </select>
          </div>
          {/if}

          <footer class="flex justify-end gap-2 pt-2">
            <button type="button" class="btn preset-tonal" onclick={onCancel}>Cancel</button>
            <button type="submit" class="btn preset-filled" disabled={!name.trim()}>
              {mode === 'import' ? 'Import & Create' : 'Create'}
            </button>
          </footer>
        </form>
      </Dialog.Content>
    </Dialog.Positioner>
  </Portal>
</Dialog>
{/if}
