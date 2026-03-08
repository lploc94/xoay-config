import * as fs from 'fs'
import * as path from 'path'
import { createHash } from 'crypto'
import { app } from 'electron'
import type { BuiltinHookInfo } from '../shared/types'
import { PATHS } from './paths'

export function getHooksDir(): string {
  return PATHS.hooks
}

export function getBuiltinHooksDir(): string {
  return PATHS.hooksBuiltin
}

export function ensureHookDirs(): void {
  fs.mkdirSync(PATHS.hooks, { recursive: true })
  fs.mkdirSync(PATHS.hooksBuiltin, { recursive: true })
}

/**
 * Get the path to bundled hook resources.
 * In dev: resources/ in project root.
 * In production: process.resourcesPath (asar-unpacked).
 */
function getResourceHooksPath(): string {
  // In packaged app, resources are at process.resourcesPath
  // In dev, they're at the project root's resources/ folder
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'resources')
  }
  // electron-vite dev: __dirname is out/main, project root is 2 levels up
  return path.join(__dirname, '../../resources')
}

function fileHash(filePath: string): string {
  const content = fs.readFileSync(filePath)
  return createHash('sha256').update(content).digest('hex')
}

/**
 * Copy built-in hooks from app resources to <userData>/hooks/builtin/.
 * Only overwrites if the bundled version has different content (newer).
 */
export function provisionBuiltinHooks(): void {
  const resourceBase = getResourceHooksPath()
  const sources = [path.join(resourceBase, 'hooks'), path.join(resourceBase, 'sample-hooks')]

  for (const srcDir of sources) {
    if (!fs.existsSync(srcDir)) continue
    const files = fs.readdirSync(srcDir).filter((f) => f.endsWith('.js'))
    for (const file of files) {
      const srcPath = path.join(srcDir, file)
      const destPath = path.join(PATHS.hooksBuiltin, file)
      if (fs.existsSync(destPath) && fileHash(srcPath) === fileHash(destPath)) {
        continue // already up-to-date
      }
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

/**
 * List built-in hooks available in <userData>/hooks/builtin/.
 */
export function listBuiltinHooks(): BuiltinHookInfo[] {
  if (!fs.existsSync(PATHS.hooksBuiltin)) return []
  const files = fs.readdirSync(PATHS.hooksBuiltin).filter((f) => f.endsWith('.js'))
  return files.map((filename) => {
    const filePath = path.join(PATHS.hooksBuiltin, filename)
    const content = fs.readFileSync(filePath, 'utf-8')
    // Extract description from first line comment: // Description: ...
    const match = content.match(/^\/\/\s*Description:\s*(.+)/m)
    return {
      name: filename.replace(/\.js$/, '').replace(/[-_]/g, ' '),
      filename,
      description: match?.[1]?.trim() ?? ''
    }
  })
}

/**
 * Validate that a script path is safe (no path traversal).
 * Throws if the path contains dangerous patterns.
 * Uses canonical path comparison to prevent symlink bypass.
 */
function validateScriptPath(scriptPath: string): void {
  // Reject absolute paths
  if (path.isAbsolute(scriptPath)) {
    throw new Error(`Security: Absolute paths not allowed in hook scripts: ${scriptPath}`)
  }

  // Reject paths with parent directory references
  if (scriptPath.includes('..')) {
    throw new Error(`Security: Path traversal detected in hook script: ${scriptPath}`)
  }

  // Get canonical path of hooks directory
  const hooksCanonical = fs.realpathSync(PATHS.hooks)

  // Resolve the script path against hooks directory
  const resolved = path.join(PATHS.hooks, scriptPath)

  // Get canonical path if file exists, otherwise normalize the path
  let resolvedCanonical: string
  try {
    resolvedCanonical = fs.realpathSync(resolved)
  } catch {
    // File doesn't exist yet - use normalized path for containment check
    resolvedCanonical = path.normalize(resolved)
  }

  // Ensure the canonical path is within hooks directory
  if (
    !resolvedCanonical.startsWith(hooksCanonical + path.sep) &&
    resolvedCanonical !== hooksCanonical
  ) {
    throw new Error(`Security: Hook script path escapes hooks directory: ${scriptPath}`)
  }
}

/**
 * Resolve a hook scriptPath to an absolute path.
 * - "builtin/xxx.js" → <userData>/hooks/builtin/xxx.js
 * - relative path (no leading /) → <userData>/hooks/<path>
 * - absolute paths are rejected for security
 */
export function resolveHookPath(scriptPath: string): string {
  // Security: Validate path before resolving
  validateScriptPath(scriptPath)

  // Relative paths resolve against the hooks directory
  return path.join(PATHS.hooks, scriptPath)
}

/**
 * Convert an absolute path to a relative path if it's inside the hooks directory.
 * Returns the original path if it's outside the hooks directory.
 * Uses canonical path comparison to prevent symlink bypass.
 */
export function toRelativeHookPath(absolutePath: string): string {
  try {
    // Get canonical paths for comparison
    const hooksCanonical = fs.realpathSync(PATHS.hooks)
    const pathCanonical = fs.realpathSync(absolutePath)

    // Check if the canonical path is within hooks directory
    if (
      pathCanonical.startsWith(hooksCanonical + path.sep) ||
      pathCanonical === hooksCanonical
    ) {
      return path.relative(PATHS.hooks, pathCanonical)
    }
  } catch {
    // If realpathSync fails (file doesn't exist), fall back to normalized comparison
    const normalized = path.normalize(absolutePath)
    const hooksPrefix = path.normalize(PATHS.hooks) + path.sep
    if (normalized.startsWith(hooksPrefix)) {
      return path.relative(PATHS.hooks, normalized)
    }
  }

  // Path is outside hooks directory - return original absolute path
  return absolutePath
}
