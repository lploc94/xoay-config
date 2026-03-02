// Sync Config hook — reads config items from disk and reports changes
// Runs as pre-switch-out: captures any edits made to files/env-vars while
// the profile was active, so the app can update stored content.
//
// Output format:
//   { "configUpdates": [{ itemId, content?, value? }] }

const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Expand ~ to the user's home directory.
 */
function expandHome(filePath) {
  if (filePath.startsWith('~/') || filePath === '~') {
    return path.join(os.homedir(), filePath.slice(1));
  }
  return filePath;
}

/**
 * Read a file safely. Returns null if the file doesn't exist or can't be read.
 */
function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Extract the value of an env var from a shell config file.
 * Matches: export NAME=VALUE, export NAME="VALUE", export NAME='VALUE'
 * Returns null if not found or file can't be read.
 */
function extractEnvValue(shellFile, varName) {
  const content = readFileSafe(shellFile);
  if (content === null) return null;

  // Match: export VAR_NAME=value (with optional quotes)
  const regex = new RegExp(
    `^\\s*export\\s+${escapeRegex(varName)}=(.*)$`,
    'm'
  );
  const match = content.match(regex);
  if (!match) return null;

  let value = match[1].trim();

  // Strip surrounding quotes if present
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  // Strip inline comment (only for unquoted or double-quoted values)
  // e.g. export FOO=bar # comment
  if (!match[1].trim().startsWith("'")) {
    const commentIdx = value.indexOf(' #');
    if (commentIdx !== -1) {
      value = value.slice(0, commentIdx).trimEnd();
    }
  }

  return value;
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── Main ───

function main() {
  const raw = process.env.XOAY_HOOK_CONTEXT;
  if (!raw) {
    // No context — nothing to do
    console.log(JSON.stringify({ configUpdates: [] }));
    return;
  }

  let ctx;
  try {
    ctx = JSON.parse(raw);
  } catch {
    console.log(JSON.stringify({ configUpdates: [] }));
    return;
  }

  const items = (ctx.profile && ctx.profile.items) || [];
  const configUpdates = [];

  for (const item of items) {
    if (!item.enabled) continue;

    if (item.type === 'file-replace') {
      const targetPath = expandHome(item.targetPath || '');
      if (!targetPath) continue;

      const diskContent = readFileSafe(targetPath);
      if (diskContent === null) continue; // file missing — skip

      if (diskContent !== item.content) {
        configUpdates.push({ itemId: item.id, content: diskContent });
      }
    } else if (item.type === 'env-var') {
      const shellFile = expandHome(item.shellFile || '');
      const varName = item.name;
      if (!shellFile || !varName) continue;

      const diskValue = extractEnvValue(shellFile, varName);
      if (diskValue === null) continue; // file missing or var not found — skip

      if (diskValue !== item.value) {
        configUpdates.push({ itemId: item.id, value: diskValue });
      }
    }
  }

  console.log(JSON.stringify({ configUpdates }));
}

main();
