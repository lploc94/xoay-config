<script lang="ts">
  import { XIcon, CheckCircleIcon, XCircleIcon, AlertTriangleIcon } from '@lucide/svelte'
  import { Dialog, Portal } from '@skeletonlabs/skeleton-svelte'
  import type { SwitchResult } from '../../../shared/types'

  interface Props {
    result: SwitchResult | null
    profileName: string
    onClose: () => void
  }

  let { result, profileName, onClose }: Props = $props()

  const allSuccess = $derived(result?.results.every((r) => r.success) ?? false)

  const animation =
    'transition transition-discrete opacity-0 translate-y-[100px] starting:data-[state=open]:opacity-0 starting:data-[state=open]:translate-y-[100px] data-[state=open]:opacity-100 data-[state=open]:translate-y-0'
</script>

{#if result}
<Dialog open={true}>
  <Portal>
    <Dialog.Backdrop class="fixed inset-0 z-50 bg-surface-950/60" />
    <Dialog.Positioner class="fixed inset-0 z-50 flex justify-center items-center p-4">
      <Dialog.Content class="card bg-surface-100-900 w-full max-w-md p-5 space-y-4 shadow-xl {animation}">
        <header class="flex justify-between items-center">
          <Dialog.Title class="text-lg font-bold">
            Switch Result — {profileName}
          </Dialog.Title>
          <button type="button" class="btn-icon hover:preset-tonal" onclick={onClose}>
            <XIcon class="size-4" />
          </button>
        </header>

        <div class="space-y-2">
          {#if allSuccess}
            <div class="flex items-center gap-2 text-success-500">
              <CheckCircleIcon class="size-5" />
              <span class="font-medium">All items switched successfully!</span>
            </div>
          {:else}
            <div class="flex items-center gap-2 text-warning-500">
              <XCircleIcon class="size-5" />
              <span class="font-medium">Some items failed</span>
            </div>
          {/if}

          <ul class="space-y-1">
            {#each result.results as r}
              <li class="flex items-center gap-2 px-3 py-2 rounded bg-surface-200-800">
                {#if r.success}
                  <CheckCircleIcon class="size-4 text-success-500 shrink-0" />
                {:else}
                  <XCircleIcon class="size-4 text-error-500 shrink-0" />
                {/if}
                <span class="flex-1 text-sm">{r.label ?? r.itemId}</span>
                {#if r.error}
                  <span class="text-xs text-error-400">{r.error}</span>
                {/if}
              </li>
            {/each}
          </ul>

          {#if result.hookResults?.length}
            <div class="pt-2 border-t border-surface-300-700">
              <span class="text-xs font-semibold uppercase text-surface-500">Hooks</span>
              <ul class="mt-1 space-y-1">
                {#each result.hookResults as hook}
                  <li class="flex items-center gap-2 px-3 py-2 rounded bg-surface-200-800">
                    {#if hook.success}
                      <CheckCircleIcon class="size-4 text-success-500 shrink-0" />
                    {:else}
                      <AlertTriangleIcon class="size-4 text-warning-500 shrink-0" />
                    {/if}
                    <span class="flex-1 text-sm">{hook.hookLabel}</span>
                    {#if hook.error}
                      <span class="text-xs text-warning-400">{hook.error}</span>
                    {/if}
                  </li>
                {/each}
              </ul>
            </div>
          {/if}
        </div>

        <footer class="flex justify-end pt-2">
          <button type="button" class="btn preset-filled" onclick={onClose}>Close</button>
        </footer>
      </Dialog.Content>
    </Dialog.Positioner>
  </Portal>
</Dialog>
{/if}
