<script lang="ts">
  import { XIcon } from '@lucide/svelte'
  import { Dialog, Portal } from '@skeletonlabs/skeleton-svelte'
  import type { SyncSettings } from '../../../shared/types'

  interface Props {
    open?: boolean
    settings: SyncSettings
    onSave: (settings: SyncSettings) => void
    onCancel: () => void
  }

  let { open = false, settings, onSave, onCancel }: Props = $props()

  let enabled = $state(false)
  let intervalMs = $state(300000)

  const intervals = [
    { label: '1 min', value: 60000 },
    { label: '5 min', value: 300000 },
    { label: '15 min', value: 900000 },
    { label: '30 min', value: 1800000 }
  ]

  $effect(() => {
    if (open) {
      enabled = settings.enabled
      intervalMs = settings.intervalMs
    }
  })

  function handleSave(): void {
    onSave({ enabled, intervalMs })
  }

  const animation =
    'transition transition-discrete opacity-0 translate-y-[100px] starting:data-[state=open]:opacity-0 starting:data-[state=open]:translate-y-[100px] data-[state=open]:opacity-100 data-[state=open]:translate-y-0'
</script>

{#if open}
<Dialog open={true}>
  <Portal>
    <Dialog.Backdrop class="fixed inset-0 z-50 bg-surface-950/60" />
    <Dialog.Positioner class="fixed inset-0 z-50 flex justify-center items-center p-4">
      <Dialog.Content class="card bg-surface-100-900 w-full max-w-sm p-5 space-y-4 shadow-xl {animation}">
        <header class="flex justify-between items-center">
          <Dialog.Title class="text-lg font-bold">Sync Settings</Dialog.Title>
          <button type="button" class="btn-icon hover:preset-tonal" onclick={onCancel}>
            <XIcon class="size-4" />
          </button>
        </header>

        <div class="space-y-4">
          <label class="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" class="checkbox" bind:checked={enabled} />
            <span class="text-sm font-medium">Enable periodic sync</span>
          </label>

          {#if enabled}
            <div>
              <span class="label text-sm font-medium mb-1">Sync interval</span>
              <div class="flex gap-2 flex-wrap">
                {#each intervals as opt}
                  <button
                    type="button"
                    class="btn btn-sm {intervalMs === opt.value ? 'preset-filled' : 'preset-tonal'}"
                    onclick={() => intervalMs = opt.value}
                  >
                    {opt.label}
                  </button>
                {/each}
              </div>
            </div>
          {/if}

          <p class="text-xs text-surface-400">
            Periodic sync checks the active profile's anchored items against disk and updates stored values when the anchor matches.
          </p>
        </div>

        <footer class="flex justify-end gap-2 pt-2">
          <button type="button" class="btn preset-tonal" onclick={onCancel}>Cancel</button>
          <button type="button" class="btn preset-filled" onclick={handleSave}>Save</button>
        </footer>
      </Dialog.Content>
    </Dialog.Positioner>
  </Portal>
</Dialog>
{/if}
