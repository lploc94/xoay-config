import { readFile, writeFile, rename, mkdir, copyFile, readdir } from 'fs/promises'
import { existsSync } from 'fs'
import { dirname, join, basename } from 'path'
import { homedir } from 'os'
import { spawn } from 'child_process'
import type {
  Profile,
  ConfigItem,
  FileReplaceItem,
  EnvVarItem,
  RunCommandItem,
  ItemResult,
  SwitchResult
} from './types'
import { PATHS } from './paths'

/** Backup metadata — internal to switch engine, not exposed to UI. */
interface BackupEntry {
  id: string
  profileId: string
  profileName: string
  timestamp: string
  files: string[]
}

const DEFAULT_TIMEOUT = 30_000

export class SwitchEngine {
  private isSwitching = false

  /**
   * Switch to a profile: backup → file-replace → env-var → run-command → report
   */
  async switch(profile: Profile): Promise<SwitchResult> {
    if (this.isSwitching) {
      throw new Error('Switch operation already in progress')
    }
    this.isSwitching = true
    try {
      return await this.executeSwitch(profile)
    } finally {
      this.isSwitching = false
    }
  }

  private async executeSwitch(profile: Profile): Promise<SwitchResult> {
    const enabledItems = profile.items.filter((item) => item.enabled)
    const backupId = await this.createBackup(profile, enabledItems)
    const results: ItemResult[] = []
    let failed = false

    // Phase 1: file-replace
    const fileItems = enabledItems.filter((i): i is FileReplaceItem => i.type === 'file-replace')
    for (const item of fileItems) {
      const result = await this.executeFileReplace(item)
      results.push(result)
      if (!result.success) {
        failed = true
        break
      }
    }

    // Phase 2: env-var (only if no failure)
    if (!failed) {
      const envItems = enabledItems.filter((i): i is EnvVarItem => i.type === 'env-var')
      for (const item of envItems) {
        const result = await this.executeEnvVar(item)
        results.push(result)
        if (!result.success) {
          failed = true
          break
        }
      }
    }

    // Rollback file-replace and env-var if failed
    if (failed) {
      await this.restoreBackup(backupId)
    }

    // Phase 3: run-command (execute regardless of rollback status for items before failure,
    // but only if no failure occurred in file-replace/env-var phases)
    if (!failed) {
      const cmdItems = enabledItems.filter(
        (i): i is RunCommandItem => i.type === 'run-command'
      )
      for (const item of cmdItems) {
        const result = await this.executeRunCommand(item)
        results.push(result)
        // run-command failures don't trigger rollback (side effects can't be undone)
        if (!result.success) {
          failed = true
          break
        }
      }
    }

    return {
      profileId: profile.id,
      backupId,
      results,
      success: !failed
    }
  }

  /**
   * Create backup of all target files and shell config files before switch.
   */
  async createBackup(profile: Profile, enabledItems: ConfigItem[]): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupId = `${timestamp}_${profile.id}`
    const backupDir = join(PATHS.backups, backupId)
    await mkdir(backupDir, { recursive: true })

    // Collect all file paths that need backup
    const filesToBackup = new Set<string>()
    for (const item of enabledItems) {
      if (item.type === 'file-replace') {
        filesToBackup.add(this.resolvePath(item.targetPath))
      } else if (item.type === 'env-var') {
        filesToBackup.add(this.resolvePath(item.shellFile))
      }
    }

    const backedUpFiles: string[] = []
    for (const filePath of filesToBackup) {
      if (existsSync(filePath)) {
        // Encode the full path as backup filename to preserve uniqueness
        const encodedName = Buffer.from(filePath).toString('base64url')
        const backupPath = join(backupDir, encodedName)
        await copyFile(filePath, backupPath)
        backedUpFiles.push(filePath)
      }
      // If file doesn't exist, skip (don't fail) — it's a new file
    }

    // Save backup metadata
    const meta: BackupEntry = {
      id: backupId,
      profileId: profile.id,
      profileName: profile.name,
      timestamp: new Date().toISOString(),
      files: backedUpFiles
    }
    await writeFile(join(backupDir, '_meta.json'), JSON.stringify(meta, null, 2), 'utf-8')

    return backupId
  }

  /**
   * Restore files from a backup.
   */
  async restoreBackup(backupId: string): Promise<void> {
    const backupDir = join(PATHS.backups, backupId)
    const metaPath = join(backupDir, '_meta.json')

    if (!existsSync(metaPath)) {
      throw new Error(`Backup not found: ${backupId}`)
    }

    const meta: BackupEntry = JSON.parse(await readFile(metaPath, 'utf-8'))

    for (const filePath of meta.files) {
      const encodedName = Buffer.from(filePath).toString('base64url')
      const backupPath = join(backupDir, encodedName)
      if (existsSync(backupPath)) {
        // Ensure target directory exists
        await mkdir(dirname(filePath), { recursive: true })
        // Atomic restore: write to temp, then rename
        const tempPath = join(dirname(filePath), `.xoay-restore-${basename(filePath)}.tmp`)
        await copyFile(backupPath, tempPath)
        await rename(tempPath, filePath)
      }
    }
  }

  /**
   * List all available backups.
   */
  async listBackups(): Promise<BackupEntry[]> {
    if (!existsSync(PATHS.backups)) {
      return []
    }

    const entries = await readdir(PATHS.backups)
    const backups: BackupEntry[] = []

    for (const entry of entries) {
      const metaPath = join(PATHS.backups, entry, '_meta.json')
      if (existsSync(metaPath)) {
        try {
          const meta: BackupEntry = JSON.parse(await readFile(metaPath, 'utf-8'))
          backups.push(meta)
        } catch {
          // Skip corrupted backup entries
        }
      }
    }

    // Sort by timestamp descending (newest first)
    backups.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    return backups
  }

  /**
   * Execute a file-replace item: atomic write (temp file → rename).
   */
  private async executeFileReplace(item: FileReplaceItem): Promise<ItemResult> {
    const targetPath = this.resolvePath(item.targetPath)
    try {
      // Ensure parent directory exists
      await mkdir(dirname(targetPath), { recursive: true })

      // Atomic write: write to temp file, then rename
      const tempPath = join(dirname(targetPath), `.xoay-${basename(targetPath)}.tmp`)
      await writeFile(tempPath, item.content, 'utf-8')
      await rename(tempPath, targetPath)

      return { itemId: item.id, type: 'file-replace', label: item.label, success: true }
    } catch (err) {
      return {
        itemId: item.id,
        type: 'file-replace',
        label: item.label,
        success: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  }

  /**
   * Execute an env-var item: find/replace export line in shell config.
   * - Regex: ^export NAME= (or ^export NAME=")
   * - If commented (#export) → skip that line
   * - If not found → append to end of file
   */
  private async executeEnvVar(item: EnvVarItem): Promise<ItemResult> {
    const shellFile = this.resolvePath(item.shellFile)
    try {
      // Validate env var name format
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(item.name)) {
        return {
          itemId: item.id,
          type: 'env-var',
          label: item.label,
          success: false,
          error: `Invalid env var name: ${item.name}`
        }
      }

      // Ensure shell file directory exists
      await mkdir(dirname(shellFile), { recursive: true })

      let content: string
      if (existsSync(shellFile)) {
        content = await readFile(shellFile, 'utf-8')
      } else {
        content = ''
      }

      // Escape shell-special characters in value
      const escapedValue = item.value
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\$/g, '\\$')
        .replace(/`/g, '\\`')
      const exportLine = `export ${item.name}="${escapedValue}"`

      // Regex to match existing export line (not commented)
      // Matches: export NAME=... (entire line)
      // Does NOT match: #export NAME=...
      const pattern = new RegExp(`^export\\s+${this.escapeRegex(item.name)}=.*$`, 'gm')
      const commentPattern = new RegExp(
        `^#\\s*export\\s+${this.escapeRegex(item.name)}=.*$`,
        'm'
      )

      const hasUncommented = pattern.test(content)
      pattern.lastIndex = 0 // Reset after .test()

      if (hasUncommented) {
        // Replace all matching uncommented export lines
        content = content.replace(pattern, exportLine)
      } else if (commentPattern.test(content)) {
        // Only commented version exists, append new line
        content = this.appendLine(content, exportLine)
      } else {
        // Not found at all, append
        content = this.appendLine(content, exportLine)
      }

      // Atomic write to shell file
      const tempPath = join(dirname(shellFile), `.xoay-${basename(shellFile)}.tmp`)
      await writeFile(tempPath, content, 'utf-8')
      await rename(tempPath, shellFile)

      return { itemId: item.id, type: 'env-var', label: item.label, success: true }
    } catch (err) {
      return {
        itemId: item.id,
        type: 'env-var',
        label: item.label,
        success: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  }

  /**
   * Execute a run-command item: spawn child process with timeout.
   */
  private async executeRunCommand(item: RunCommandItem): Promise<ItemResult> {
    const timeout = item.timeout ?? DEFAULT_TIMEOUT
    const workingDir = item.workingDir ? this.resolvePath(item.workingDir) : homedir()

    return new Promise((resolve) => {
      let stdout = ''
      let stderr = ''
      let killed = false

      const child = spawn('sh', ['-c', item.command], {
        cwd: workingDir,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe']
      })

      const timer = setTimeout(() => {
        killed = true
        child.kill('SIGTERM')
        // Force kill after 5s if SIGTERM doesn't work
        setTimeout(() => {
          if (!child.killed) {
            child.kill('SIGKILL')
          }
        }, 5000)
      }, timeout)

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString()
      })
      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString()
      })

      child.on('error', (err) => {
        clearTimeout(timer)
        resolve({
          itemId: item.id,
          type: 'run-command',
          label: item.label,
          success: false,
          error: err.message,
          stdout,
          stderr
        })
      })

      child.on('close', (code) => {
        clearTimeout(timer)
        if (killed) {
          resolve({
            itemId: item.id,
            type: 'run-command',
            label: item.label,
            success: false,
            error: `Command timed out after ${timeout}ms`,
            stdout,
            stderr
          })
        } else if (code !== 0) {
          resolve({
            itemId: item.id,
            type: 'run-command',
            label: item.label,
            success: false,
            error: `Command exited with code ${code}`,
            stdout,
            stderr
          })
        } else {
          resolve({
            itemId: item.id,
            type: 'run-command',
            label: item.label,
            success: true,
            stdout,
            stderr
          })
        }
      })
    })
  }

  /**
   * Resolve ~ to homedir in paths.
   */
  private resolvePath(p: string): string {
    if (p.startsWith('~/')) {
      return join(homedir(), p.slice(2))
    }
    return p
  }

  /**
   * Escape special regex characters.
   */
  private escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  /**
   * Append a line to content, ensuring proper newline handling.
   */
  private appendLine(content: string, line: string): string {
    if (content.length === 0) {
      return line + '\n'
    }
    if (!content.endsWith('\n')) {
      return content + '\n' + line + '\n'
    }
    return content + line + '\n'
  }
}

/** Shared singleton — ensures the concurrency lock works across IPC and tray. */
export const switchEngine = new SwitchEngine()
