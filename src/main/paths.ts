import { app } from 'electron'
import path from 'path'

/**
 * Centralized app paths using Electron's app.getPath('userData').
 *
 * Resolves to:
 *   macOS:   ~/Library/Application Support/xoay-config/
 *   Windows: %APPDATA%\xoay-config\
 *   Linux:   ~/.config/xoay-config/
 *
 * IMPORTANT: Only access PATHS after app.whenReady() has resolved.
 * All consumers (switch-engine, hook-storage, ipc handlers) are
 * called from within the whenReady callback, so this is safe.
 */

let _paths: {
  readonly userData: string
  readonly backups: string
  readonly hooks: string
  readonly hooksBuiltin: string
} | null = null

function init(): typeof _paths & object {
  if (_paths) return _paths
  const userData = app.getPath('userData')
  _paths = {
    userData,
    backups: path.join(userData, 'backups'),
    hooks: path.join(userData, 'hooks'),
    hooksBuiltin: path.join(userData, 'hooks', 'builtin'),
  } as const
  return _paths
}

/** App directory paths — lazily resolved on first access after app.whenReady(). */
export const PATHS = {
  get userData(): string { return init().userData },
  get backups(): string { return init().backups },
  get hooks(): string { return init().hooks },
  get hooksBuiltin(): string { return init().hooksBuiltin },
} as const
