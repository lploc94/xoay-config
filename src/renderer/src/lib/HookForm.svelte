<script lang="ts">
  import { XIcon } from '@lucide/svelte'
  import { Dialog, Portal } from '@skeletonlabs/skeleton-svelte'
  import type { ProfileHook, BuiltinHookInfo } from '../../../shared/types'
  import { listBuiltinHooks } from './ipc'

  interface Props {
    hook?: ProfileHook | null
    open?: boolean
    onSave: (hook: ProfileHook) => void
    onCancel: () => void
    onSelectFile: () => Promise<string | null>
  }

  let { hook = null, open = false, onSave, onCancel, onSelectFile }: Props = $props()

  let label = $state('')
  let hookType = $state<ProfileHook['type']>('post-switch-in')
  let scriptPath = $state('')
  let enabled = $state(true)
  let cronIntervalSec = $state(60)
  let timeoutSec = $state(30)
  let builtinHooks = $state<BuiltinHookInfo[]>([])
  let showBuiltin = $state(false)

  $effect(() => {
    if (open) {
      const h = hook
      label = h?.label ?? ''
      hookType = h?.type ?? 'post-switch-in'
      scriptPath = h?.scriptPath ?? ''
      enabled = h?.enabled ?? true
      cronIntervalSec = h?.cronIntervalMs ? Math.round(h.cronIntervalMs / 1000) : 60
      timeoutSec = h?.timeout ? Math.round(h.timeout / 1000) : 30
      showBuiltin = false
      loadBuiltinHooks()
    }
  })

  async function loadBuiltinHooks(): Promise<void> {
    try {
      builtinHooks = await listBuiltinHooks()
    } catch {
      builtinHooks = []
    }
  }

  function selectBuiltin(hook: BuiltinHookInfo): void {
    scriptPath = `builtin/${hook.filename}`
    if (!label) {
      label = hook.name
    }
    showBuiltin = false
  }

  async function handleBrowse(): Promise<void> {
    const path = await onSelectFile()
    if (path) {
      scriptPath = path
    }
  }

  function handleSave(): void {
    const id = hook?.id ?? crypto.randomUUID()
    const result: ProfileHook = {
      id,
      label,
      enabled,
      type: hookType,
      scriptPath,
      timeout: timeoutSec * 1000
    }
    if (hookType === 'cron') {
      result.cronIntervalMs = Math.max(cronIntervalSec * 1000, 10000)
    }
    onSave(result)
  }

  const isEditing = $derived(!!hook)
  const title = $derived(isEditing ? 'Edit Hook' : 'Add Hook')

  const animation =
    'transition transition-discrete opacity-0 translate-y-[100px] starting:data-[state=open]:opacity-0 starting:data-[state=open]:translate-y-[100px] data-[state=open]:opacity-100 data-[state=open]:translate-y-0'
</script>

{#if open}
<Dialog open={true}>
  <Portal>
    <Dialog.Backdrop class="fixed inset-0 z-50 bg-surface-950/60" />
    <Dialog.Positioner class="fixed inset-0 z-50 flex justify-center items-center p-4">
      <Dialog.Content class="card bg-surface-100-900 w-full max-w-lg p-5 space-y-4 shadow-xl {animation}">
        <header class="flex justify-between items-center">
          <Dialog.Title class="text-lg font-bold">{title}</Dialog.Title>
          <button type="button" class="btn-icon hover:preset-tonal" onclick={onCancel}>
            <XIcon class="size-4" />
          </button>
        </header>

        <form class="space-y-3" onsubmit={(e) => { e.preventDefault(); handleSave() }}>
          <!-- Label -->
          <div>
            <label for="hook-label" class="label text-sm font-medium mb-1">Label</label>
            <input id="hook-label" class="input" type="text" bind:value={label} placeholder="Hook name" required />
          </div>

          <!-- Type -->
          <div>
            <label for="hook-type" class="label text-sm font-medium mb-1">Type</label>
            <select id="hook-type" class="select" bind:value={hookType}>
              <option value="pre-switch-in">Pre Switch In</option>
              <option value="post-switch-in">Post Switch In</option>
              <option value="pre-switch-out">Pre Switch Out</option>
              <option value="post-switch-out">Post Switch Out</option>
              <option value="cron">Cron</option>
            </select>
          </div>

          <!-- Script Path -->
          <div>
            <label for="hook-script" class="label text-sm font-medium mb-1">Script Path</label>
            <div class="flex gap-2">
              <input id="hook-script" class="input flex-1" type="text" bind:value={scriptPath} placeholder="builtin/codex-quota.js" required />
              <button type="button" class="btn btn-sm preset-tonal" onclick={handleBrowse}>Browse</button>
              {#if builtinHooks.length > 0}
                <button type="button" class="btn btn-sm preset-tonal" onclick={() => showBuiltin = !showBuiltin}>Built-in</button>
              {/if}
            </div>
            {#if showBuiltin && builtinHooks.length > 0}
              <div class="mt-2 border border-surface-300-700 rounded-md overflow-hidden">
                {#each builtinHooks as bh}
                  <button
                    type="button"
                    class="w-full text-left px-3 py-2 hover:bg-surface-200-800 flex flex-col"
                    onclick={() => selectBuiltin(bh)}
                  >
                    <span class="text-sm font-medium">{bh.name}</span>
                    {#if bh.description}
                      <span class="text-xs text-surface-400">{bh.description}</span>
                    {/if}
                  </button>
                {/each}
              </div>
            {/if}
          </div>

          <!-- Cron Interval (only for cron type) -->
          {#if hookType === 'cron'}
            <div>
              <label for="hook-interval" class="label text-sm font-medium mb-1">Interval (seconds)</label>
              <input id="hook-interval" class="input" type="number" bind:value={cronIntervalSec} min="10" required />
              <p class="text-xs text-surface-400 mt-1">Minimum 10 seconds</p>
            </div>
          {/if}

          <!-- Timeout -->
          <div>
            <label for="hook-timeout" class="label text-sm font-medium mb-1">Timeout (seconds, optional)</label>
            <input id="hook-timeout" class="input" type="number" bind:value={timeoutSec} min="1" max="300" />
          </div>

          <!-- Enabled -->
          <label class="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" class="checkbox" bind:checked={enabled} />
            <span class="text-sm">Enabled</span>
          </label>

          <footer class="flex justify-end gap-2 pt-2">
            <button type="button" class="btn preset-tonal" onclick={onCancel}>Cancel</button>
            <button type="submit" class="btn preset-filled">{isEditing ? 'Save' : 'Add'}</button>
          </footer>
        </form>
      </Dialog.Content>
    </Dialog.Positioner>
  </Portal>
</Dialog>
{/if}
