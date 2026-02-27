<script lang="ts">
  import { XIcon, FileIcon, TerminalIcon, VariableIcon } from '@lucide/svelte'
  import { Dialog, Portal } from '@skeletonlabs/skeleton-svelte'
  import type { ConfigItem, FileReplaceItem, EnvVarItem, RunCommandItem } from '../../../shared/types'

  interface Props {
    item?: ConfigItem | null
    open?: boolean
    onSave: (item: ConfigItem) => void
    onCancel: () => void
  }

  let { item = null, open = false, onSave, onCancel }: Props = $props()

  let itemType = $state<ConfigItem['type']>('file-replace')
  let label = $state('')
  let enabled = $state(true)

  // file-replace fields
  let targetPath = $state('')
  let content = $state('')

  // env-var fields
  let envName = $state('')
  let envValue = $state('')
  let shellFile = $state('~/.zshrc')

  // run-command fields
  let command = $state('')
  let workingDir = $state('')
  let timeout = $state(30000)

  $effect(() => {
    if (open) {
      const i = item
      itemType = i?.type ?? 'file-replace'
      label = i?.label ?? ''
      enabled = i?.enabled ?? true
      targetPath = (i as FileReplaceItem)?.targetPath ?? ''
      content = (i as FileReplaceItem)?.content ?? ''
      envName = (i as EnvVarItem)?.name ?? ''
      envValue = (i as EnvVarItem)?.value ?? ''
      shellFile = (i as EnvVarItem)?.shellFile ?? '~/.zshrc'
      command = (i as RunCommandItem)?.command ?? ''
      workingDir = (i as RunCommandItem)?.workingDir ?? ''
      timeout = (i as RunCommandItem)?.timeout ?? 30000
    }
  })

  function handleSave(): void {
    const id = item?.id ?? crypto.randomUUID()
    let result: ConfigItem

    if (itemType === 'file-replace') {
      result = { id, type: 'file-replace', label, enabled, targetPath, content }
    } else if (itemType === 'env-var') {
      result = { id, type: 'env-var', label, enabled, name: envName, value: envValue, shellFile }
    } else {
      result = { id, type: 'run-command', label, enabled, command, workingDir: workingDir || undefined, timeout }
    }

    onSave(result)
  }

  const isEditing = $derived(!!item)
  const title = $derived(isEditing ? 'Edit Config Item' : 'Add Config Item')

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
          <!-- Type selector (only for new items) -->
          {#if !isEditing}
          <div>
            <span class="label text-sm font-medium mb-1">Type</span>
            <div class="flex gap-2">
              <button type="button" class="btn text-sm {itemType === 'file-replace' ? 'preset-filled' : 'preset-tonal'}" onclick={() => itemType = 'file-replace'}>
                <FileIcon class="size-4" /> File Replace
              </button>
              <button type="button" class="btn text-sm {itemType === 'env-var' ? 'preset-filled' : 'preset-tonal'}" onclick={() => itemType = 'env-var'}>
                <VariableIcon class="size-4" /> Env Var
              </button>
              <button type="button" class="btn text-sm {itemType === 'run-command' ? 'preset-filled' : 'preset-tonal'}" onclick={() => itemType = 'run-command'}>
                <TerminalIcon class="size-4" /> Command
              </button>
            </div>
          </div>
          {/if}

          <!-- Label -->
          <div>
            <label for="item-label" class="label text-sm font-medium mb-1">Label</label>
            <input id="item-label" class="input" type="text" bind:value={label} placeholder="Config item name" required />
          </div>

          <!-- Type-specific fields -->
          {#if itemType === 'file-replace'}
            <div>
              <label for="target-path" class="label text-sm font-medium mb-1">Target Path</label>
              <input id="target-path" class="input" type="text" bind:value={targetPath} placeholder="~/.claude/settings.json" required />
            </div>
            <div>
              <label for="file-content" class="label text-sm font-medium mb-1">Content</label>
              <textarea id="file-content" class="textarea min-h-[120px] font-mono text-sm" bind:value={content} placeholder="File content..." rows="6"></textarea>
            </div>
          {:else if itemType === 'env-var'}
            <div>
              <label for="env-name" class="label text-sm font-medium mb-1">Variable Name</label>
              <input id="env-name" class="input" type="text" bind:value={envName} placeholder="ANTHROPIC_AUTH_TOKEN" required />
            </div>
            <div>
              <label for="env-value" class="label text-sm font-medium mb-1">Value</label>
              <input id="env-value" class="input" type="text" bind:value={envValue} placeholder="sk-..." required />
            </div>
            <div>
              <label for="shell-file" class="label text-sm font-medium mb-1">Shell File</label>
              <input id="shell-file" class="input" type="text" bind:value={shellFile} placeholder="~/.zshrc" required />
            </div>
          {:else}
            <div>
              <label for="cmd" class="label text-sm font-medium mb-1">Command</label>
              <input id="cmd" class="input" type="text" bind:value={command} placeholder="echo hello" required />
            </div>
            <div>
              <label for="working-dir" class="label text-sm font-medium mb-1">Working Directory (optional)</label>
              <input id="working-dir" class="input" type="text" bind:value={workingDir} placeholder="~/" />
            </div>
            <div>
              <label for="timeout" class="label text-sm font-medium mb-1">Timeout (ms)</label>
              <input id="timeout" class="input" type="number" bind:value={timeout} min="1000" max="300000" />
            </div>
          {/if}

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
