<script lang="ts">
  import { XIcon, FileIcon, TerminalIcon, VariableIcon } from '@lucide/svelte'
  import { Dialog, Portal } from '@skeletonlabs/skeleton-svelte'
  import type { ConfigItem, FileReplaceItem, EnvVarItem, RunCommandItem, AnchorConfig } from '../../../shared/types'

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

  // anchor fields
  let anchorType = $state<'none' | 'json-path' | 'line-content' | 'env-value'>('none')
  let anchorJsonPath = $state('')
  let anchorJsonValue = $state('')
  let anchorLine = $state(1)
  let anchorLineValue = $state('')
  let anchorEnvName = $state('')
  let anchorEnvValue = $state('')

  /** Extract leaf-level key paths from a JSON string (max depth 3) */
  function extractJsonPaths(jsonStr: string): Array<{ path: string; value: string }> {
    try {
      const obj = JSON.parse(jsonStr)
      if (typeof obj !== 'object' || obj === null) return []
      const results: Array<{ path: string; value: string }> = []
      function walk(current: unknown, prefix: string, depth: number): void {
        if (depth > 3) return
        if (typeof current === 'object' && current !== null && !Array.isArray(current)) {
          for (const [key, val] of Object.entries(current)) {
            const path = prefix ? `${prefix}.${key}` : key
            if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
              walk(val, path, depth + 1)
            } else {
              results.push({ path, value: String(val) })
            }
          }
        }
      }
      walk(obj, '', 0)
      return results
    } catch {
      return []
    }
  }

  const jsonPaths = $derived(itemType === 'file-replace' ? extractJsonPaths(content) : [])

  // Reset anchor when itemType changes (e.g. file-replace → env-var makes json-path invalid)
  let prevItemType = $state<ConfigItem['type']>('file-replace')
  $effect(() => {
    if (itemType !== prevItemType) {
      prevItemType = itemType
      anchorType = 'none'
      anchorJsonPath = ''
      anchorJsonValue = ''
      anchorLine = 1
      anchorLineValue = ''
      anchorEnvName = ''
      anchorEnvValue = ''
    }
  })

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

      // anchor fields
      const anchor = (i as FileReplaceItem | EnvVarItem)?.anchor
      if (anchor) {
        anchorType = anchor.type
        if (anchor.type === 'json-path') {
          anchorJsonPath = anchor.path
          anchorJsonValue = anchor.value
        } else if (anchor.type === 'line-content') {
          anchorLine = anchor.line
          anchorLineValue = anchor.value
        } else if (anchor.type === 'env-value') {
          anchorEnvName = anchor.name
          anchorEnvValue = anchor.value
        }
      } else {
        anchorType = 'none'
        anchorJsonPath = ''
        anchorJsonValue = ''
        anchorLine = 1
        anchorLineValue = ''
        anchorEnvName = ''
        anchorEnvValue = ''
      }
    }
  })

  function buildAnchor(): AnchorConfig | undefined {
    if (anchorType === 'json-path') {
      return { type: 'json-path', path: anchorJsonPath, value: anchorJsonValue }
    } else if (anchorType === 'line-content') {
      return { type: 'line-content', line: anchorLine, value: anchorLineValue }
    } else if (anchorType === 'env-value') {
      return { type: 'env-value', name: anchorEnvName, value: anchorEnvValue }
    }
    return undefined
  }

  function handleSave(): void {
    const id = item?.id ?? crypto.randomUUID()
    let result: ConfigItem

    if (itemType === 'file-replace') {
      const anchor = buildAnchor()
      result = { id, type: 'file-replace', label, enabled, targetPath, content, ...(anchor && { anchor }) }
    } else if (itemType === 'env-var') {
      const anchor = buildAnchor()
      result = { id, type: 'env-var', label, enabled, name: envName, value: envValue, shellFile, ...(anchor && { anchor }) }
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

          <!-- Anchor section (file-replace and env-var only) -->
          {#if itemType === 'file-replace' || itemType === 'env-var'}
          <fieldset class="border border-surface-300-700 rounded-md p-3 space-y-3">
            <legend class="text-sm font-medium px-1 text-surface-600-400">Anchor (optional)</legend>

            <div>
              <label for="anchor-type" class="label text-sm font-medium mb-1">Anchor Type</label>
              <select id="anchor-type" class="select" bind:value={anchorType} onchange={() => { anchorJsonPath = ''; anchorJsonValue = ''; anchorLine = 1; anchorLineValue = ''; anchorEnvName = ''; anchorEnvValue = '' }}>
                <option value="none">None</option>
                {#if itemType === 'file-replace'}
                  <option value="json-path">JSON Path</option>
                  <option value="line-content">Line Content</option>
                {/if}
                {#if itemType === 'env-var'}
                  <option value="env-value">Env Value</option>
                {/if}
              </select>
            </div>

            {#if anchorType === 'json-path'}
              <div>
                <label for="anchor-json-path" class="label text-sm font-medium mb-1">Path</label>
                {#if jsonPaths.length > 0}
                  <select id="anchor-json-path" class="select" bind:value={anchorJsonPath} onchange={(e) => {
                    const selected = jsonPaths.find(p => p.path === (e.target as HTMLSelectElement).value)
                    if (selected) anchorJsonValue = selected.value
                  }}>
                    <option value="">Select a path...</option>
                    {#each jsonPaths as jp}
                      <option value={jp.path}>{jp.path} → {jp.value}</option>
                    {/each}
                  </select>
                {:else}
                  <input id="anchor-json-path" class="input" type="text" bind:value={anchorJsonPath} placeholder="tokens.account_id" required />
                {/if}
              </div>
              <div>
                <label for="anchor-json-value" class="label text-sm font-medium mb-1">Value</label>
                <input id="anchor-json-value" class="input" type="text" bind:value={anchorJsonValue} placeholder="Expected value at this path" required />
              </div>
            {:else if anchorType === 'line-content'}
              <div>
                <label for="anchor-line" class="label text-sm font-medium mb-1">Line #</label>
                <input id="anchor-line" class="input" type="number" bind:value={anchorLine} min="1" required />
              </div>
              <div>
                <label for="anchor-line-value" class="label text-sm font-medium mb-1">Value</label>
                <input id="anchor-line-value" class="input" type="text" bind:value={anchorLineValue} placeholder="Expected line content" required />
              </div>
            {:else if anchorType === 'env-value'}
              <div>
                <label for="anchor-env-name" class="label text-sm font-medium mb-1">Variable</label>
                <input id="anchor-env-name" class="input" type="text" bind:value={anchorEnvName} placeholder="A different env var to anchor on" required />
              </div>
              <div>
                <label for="anchor-env-value" class="label text-sm font-medium mb-1">Value</label>
                <input id="anchor-env-value" class="input" type="text" bind:value={anchorEnvValue} placeholder="Expected value" required />
              </div>
            {/if}
          </fieldset>
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
