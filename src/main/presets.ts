import type { Preset } from '../shared/types'

export const PRESETS: Preset[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    description: 'Config items for Claude Code CLI (settings.json + env vars)',
    defaultItems: [
      {
        id: 'claude-settings',
        type: 'file-replace',
        label: 'Claude settings.json',
        enabled: true,
        targetPath: '~/.claude/settings.json',
        content: ''
      },
      {
        id: 'claude-base-url',
        type: 'env-var',
        label: 'ANTHROPIC_BASE_URL',
        enabled: true,
        name: 'ANTHROPIC_BASE_URL',
        value: '',
        shellFile: '~/.zshrc'
      },
      {
        id: 'claude-auth-token',
        type: 'env-var',
        label: 'ANTHROPIC_AUTH_TOKEN',
        enabled: true,
        name: 'ANTHROPIC_AUTH_TOKEN',
        value: '',
        shellFile: '~/.zshrc'
      }
    ]
  },
  {
    id: 'codex-cli',
    name: 'Codex CLI',
    description: 'Config items for Codex CLI (config.toml + auth.json)',
    defaultItems: [
      {
        id: 'codex-config',
        type: 'file-replace',
        label: 'Codex config.toml',
        enabled: true,
        targetPath: '~/.codex/config.toml',
        content: ''
      },
      {
        id: 'codex-auth',
        type: 'file-replace',
        label: 'Codex auth.json',
        enabled: true,
        targetPath: '~/.codex/auth.json',
        content: ''
      }
    ]
  }
]

export function getPresetById(id: string): Preset | undefined {
  return PRESETS.find((p) => p.id === id)
}
