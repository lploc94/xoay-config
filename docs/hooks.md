# Hook System

## Overview

The hook system lets you attach JavaScript scripts to profiles. Scripts run automatically at specific points during the profile switching lifecycle or on a recurring schedule (cron). This enables custom automation such as saving state before a switch, checking API quotas, sending notifications, or triggering automatic profile rotation.

**How it works:**

1. You attach `.js` scripts to a profile and choose when they run (e.g., before switch-out, after switch-in, or on a cron schedule).
2. When the event fires, the app spawns your script as a child process using Electron's `utilityProcess.fork()`.
3. Your script receives context about the current profile via the `XOAY_HOOK_CONTEXT` environment variable.
4. Your script can return structured JSON output via `stdout` — the app parses it and displays the data on the profile UI.

**Cross-platform:** Hooks run on macOS, Linux, and Windows. Scripts execute in a Node.js environment provided by Electron's utility process.

**Best-effort execution:** Hook failures never block a profile switch. If a hook fails (timeout, crash, non-zero exit), the error is captured and shown in the switch result dialog, but the switch continues normally.

---

## Hook Types

Each hook has a `type` that determines when it runs during the switch lifecycle.

### `pre-switch-out`

Runs **before leaving the old profile**. The old profile's config files are still in place.

**Use cases:** Save application state, run `git stash`, close connections, export data.

```js
// pre-switch-out-example.js — Git stash before switching
const { execSync } = require('child_process');
const ctx = JSON.parse(process.env.XOAY_HOOK_CONTEXT);

try {
  const status = execSync('git status --porcelain', { encoding: 'utf-8' }).trim();
  if (status) {
    execSync(`git stash push -m "xoay-auto: ${ctx.profileName}"`);
    console.log(JSON.stringify({
      display: {
        gitStash: { value: 'Stashed', label: 'Git State', status: 'ok' }
      }
    }));
  }
} catch (err) {
  console.error('Git stash failed:', err.message);
  process.exit(1);
}
```

### `post-switch-out`

Runs **after the old profile has been synced** but before the new profile's config is applied. The old config is no longer active at this point.

**Use cases:** Logging, notifications, cleanup of temporary files.

```js
// post-switch-out-example.js — Log that we left a profile
const ctx = JSON.parse(process.env.XOAY_HOOK_CONTEXT);
const fs = require('fs');
const path = require('path');

const logFile = path.join(require('os').homedir(), '.xoay', 'switch-log.txt');
const line = `[${new Date().toISOString()}] Left profile "${ctx.profileName}"\n`;

fs.mkdirSync(path.dirname(logFile), { recursive: true });
fs.appendFileSync(logFile, line);
```

### `pre-switch-in`

Runs **after the new profile's config has been applied** but before the profile is marked as active.

**Use cases:** Validate environment, pre-warm caches, check that config files were written correctly.

```js
// pre-switch-in-example.js — Validate that config files exist
const fs = require('fs');
const ctx = JSON.parse(process.env.XOAY_HOOK_CONTEXT);

const missing = [];
for (const item of ctx.profile.items) {
  if (item.type === 'file-replace' && item.enabled) {
    if (!fs.existsSync(item.targetPath)) {
      missing.push(item.targetPath);
    }
  }
}

if (missing.length > 0) {
  console.log(JSON.stringify({
    display: {
      configCheck: {
        value: `${missing.length} file(s) missing`,
        label: 'Config Validation',
        status: 'warning'
      }
    }
  }));
} else {
  console.log(JSON.stringify({
    display: {
      configCheck: { value: 'All files present', label: 'Config Validation', status: 'ok' }
    }
  }));
}
```

### `post-switch-in`

Runs **after the profile is fully active** (activeProfileId has been updated).

**Use cases:** Notifications, quota checks, logging, triggering auto-switch.

```js
// post-switch-in-example.js — Log switch time and display it
const fs = require('fs');
const path = require('path');
const ctx = JSON.parse(process.env.XOAY_HOOK_CONTEXT);

const logFile = path.join(require('os').homedir(), '.xoay', 'switch-log.txt');
const timestamp = new Date().toISOString();
const line = `[${timestamp}] Switched to "${ctx.profileName}" (${ctx.hookType})\n`;

fs.mkdirSync(path.dirname(logFile), { recursive: true });
fs.appendFileSync(logFile, line);

console.log(JSON.stringify({
  display: {
    lastSwitch: { value: timestamp, label: 'Last Switch' }
  }
}));
```

### `cron`

Runs **periodically** while the profile is active. Automatically starts when the profile becomes active and stops when you switch to another profile or quit the app.

**Use cases:** Periodic quota checks, health checks, usage monitoring, auto-switching when a condition is met.

```js
// cron-example.js — Check API quota and auto-switch if exhausted
const https = require('https');
const ctx = JSON.parse(process.env.XOAY_HOOK_CONTEXT);

function checkQuota() {
  return new Promise((resolve, reject) => {
    https.get('https://api.example.com/quota', { headers: { 'Authorization': 'Bearer ...' } }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

checkQuota().then((quota) => {
  const output = {
    display: {
      quota: {
        value: `${quota.remaining}/${quota.total}`,
        label: 'API Quota',
        status: quota.remaining > 100 ? 'ok' : quota.remaining > 0 ? 'warning' : 'error'
      }
    }
  };

  // Auto-switch if quota is exhausted
  if (quota.remaining === 0) {
    output.actions = { switchToNextProfile: true };
    output.display.quota.value += ' (switching...)';
  }

  console.log(JSON.stringify(output));
}).catch((err) => {
  console.error('Quota check failed:', err.message);
  process.exit(1);
});
```

---

## Hook Lifecycle

When you switch from one profile to another, hooks run in this order:

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Profile Switch Flow                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. Stop cron hooks (OLD profile)                                   │
│     └─ All active cron intervals are cleared                       │
│                                                                     │
│  2. pre-switch-out hooks (OLD profile)                              │
│     └─ Old config is still in place                                │
│                                                                     │
│  3. Sync active profile                                             │
│     └─ Best-effort: anchor-based sync of changed files             │
│                                                                     │
│  4. post-switch-out hooks (OLD profile)                             │
│     └─ Sync complete, old config about to be replaced              │
│                                                                     │
│  5. switchEngine.switch(newProfile)                                 │
│     └─ Config files are replaced/applied here                      │
│                                                                     │
│  6. pre-switch-in hooks (NEW profile)                               │
│     └─ New config applied, but activeProfileId not yet updated     │
│                                                                     │
│  7. Update activeProfileId                                          │
│     └─ Profile is now officially active                            │
│                                                                     │
│  8. post-switch-in hooks (NEW profile)                              │
│     └─ Profile fully active, safe to query status                  │
│                                                                     │
│  9. Start cron hooks (NEW profile)                                  │
│     └─ Periodic hooks begin running on their intervals             │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Key points:**

- Steps 2 and 4 run hooks from the **old** profile. Steps 6 and 8 run hooks from the **new** profile.
- All hooks are best-effort — a failure at any step does not block the switch.
- Hook results from all steps are collected and displayed in the switch result dialog.
- Steps 6-9 only run if the switch engine succeeds (step 5).

---

## Input — Hook Context

Every hook receives context about the current operation via the `XOAY_HOOK_CONTEXT` environment variable. The value is a JSON string.

### Reading the context

```js
const ctx = JSON.parse(process.env.XOAY_HOOK_CONTEXT);
```

### Context structure

```json
{
  "profileId": "abc-123",
  "profileName": "Work Account",
  "hookType": "post-switch-in",
  "profile": {
    "id": "abc-123",
    "name": "Work Account",
    "items": [
      {
        "id": "item-1",
        "label": "AWS Config",
        "enabled": true,
        "type": "file-replace",
        "targetPath": "~/.aws/credentials",
        "content": "..."
      }
    ],
    "hooks": [
      {
        "id": "hook-1",
        "label": "Log Switch",
        "enabled": true,
        "type": "post-switch-in",
        "scriptPath": "/path/to/log-switch.js"
      }
    ],
    "createdAt": "2025-01-01T00:00:00.000Z",
    "updatedAt": "2025-01-15T12:00:00.000Z"
  }
}
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `profileId` | `string` | ID of the profile this hook belongs to |
| `profileName` | `string` | Human-readable name of the profile |
| `hookType` | `string` | One of: `pre-switch-out`, `post-switch-out`, `pre-switch-in`, `post-switch-in`, `cron` |
| `profile` | `object` | Full profile object including `items` and `hooks` |

---

## Output — Structured Response

Hooks communicate results back to the app by writing JSON to `stdout`. The app attempts to parse the last output as JSON. If parsing fails, the output is ignored (no error).

### Output format

```json
{
  "display": {
    "quotaRemaining": {
      "value": "1500/5000",
      "label": "API Quota",
      "status": "ok"
    },
    "lastCheck": {
      "value": "2025-06-15 14:30",
      "label": "Last Check"
    }
  },
  "actions": {
    "switchToNextProfile": true,
    "notify": "Quota exhausted, switching profile"
  }
}
```

### `display` — UI Data

Each key in `display` is a named field shown on the profile detail view.

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `value` | `string \| null` | Yes | The display value. Set to `null` to remove this field. |
| `label` | `string` | No | Human-readable label (e.g., "API Quota"). Defaults to the key name. |
| `status` | `"ok" \| "warning" \| "error"` | No | Color coding for the value. |

**Merge semantics:**

- Only fields present in the output are updated.
- Fields not included in the output are left unchanged (not cleared).
- Setting `value` to `null` explicitly removes that field.

```js
// Update only "quota", leave other display fields untouched
console.log(JSON.stringify({
  display: {
    quota: { value: '42/100', label: 'Remaining', status: 'warning' }
  }
}));

// Remove the "quota" field from the display
console.log(JSON.stringify({
  display: {
    quota: { value: null }
  }
}));
```

### `actions` — Trigger App Behavior

Actions let hooks trigger application behavior. Only processed when the hook exits with code 0 (success).

| Property | Type | Description |
|----------|------|-------------|
| `switchToNextProfile` | `boolean` | Switch to the next profile in the list (circular order) |
| `switchToProfile` | `string` | Switch to a specific profile by ID (overrides `switchToNextProfile`) |
| `notify` | `string` | Show an inline notification with a custom message |

**Restrictions on switch actions:**

- Switch actions (`switchToNextProfile`, `switchToProfile`) are only allowed from `cron` and `post-switch-in` hooks. They are silently ignored in other hook types.
- A 30-second cooldown prevents rapid switch loops. If a switch action fires within 30 seconds of the last one, it is ignored.

```js
// Auto-switch when a condition is met (only works in cron/post-switch-in hooks)
console.log(JSON.stringify({
  actions: {
    switchToNextProfile: true,
    notify: 'Quota depleted — rotating to next profile'
  }
}));
```

### Non-JSON output

If your script writes non-JSON text to stdout, it is simply ignored. The hook still succeeds or fails based on its exit code. This means you can safely use `console.log()` for debugging during development — just make sure your final output is the JSON line if you want structured data.

---

## Cron Hooks

Cron hooks run on a repeating interval while their profile is active.

### Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `cronIntervalMs` | `number` | `60000` (1 min) | Interval in milliseconds between runs |
| `timeout` | `number` | `30000` (30s) | Maximum execution time per run |

**Minimum interval:** 10 seconds (10,000 ms). Values below this are clamped to 10 seconds.

### Lifecycle

1. **Start:** Cron hooks start automatically when their profile becomes active (after `post-switch-in` hooks complete).
2. **Run:** Each hook runs independently on its own `setInterval`. Multiple cron hooks can run concurrently.
3. **Stop:** All cron hooks stop when:
   - You switch to a different profile
   - The app quits (`before-quit` event)

### Error handling

- If a cron hook fails (non-zero exit, timeout), the error is logged but the scheduler continues.
- The hook will run again at the next interval. There is no backoff or retry limit.
- A cron hook re-checks that its profile is still active before each run, guarding against race conditions.

### Example: Periodic health check

```js
// health-check.js — Cron hook, runs every 30 seconds
const https = require('https');
const ctx = JSON.parse(process.env.XOAY_HOOK_CONTEXT);

function ping(url) {
  return new Promise((resolve) => {
    const req = https.get(url, (res) => {
      resolve({ ok: res.statusCode === 200, status: res.statusCode });
    });
    req.on('error', (err) => resolve({ ok: false, status: err.message }));
    req.setTimeout(5000, () => { req.destroy(); resolve({ ok: false, status: 'timeout' }); });
  });
}

ping('https://api.example.com/health').then((result) => {
  console.log(JSON.stringify({
    display: {
      health: {
        value: result.ok ? 'Healthy' : `Down (${result.status})`,
        label: 'API Status',
        status: result.ok ? 'ok' : 'error'
      }
    }
  }));

  if (!result.ok) {
    process.exit(1); // Mark as failed, but scheduler will retry next interval
  }
});
```

---

## Managing Hooks via UI

### Adding a hook

1. Open a profile's detail view.
2. In the Hooks section, click **Add Hook**.
3. Select a `.js` file using the file picker.
4. Choose the hook type (`pre-switch-out`, `post-switch-out`, `pre-switch-in`, `post-switch-in`, or `cron`).
5. Optionally configure:
   - **Timeout** — Maximum execution time (default: 30 seconds).
   - **Interval** — For cron hooks only. How often to run (default: 60 seconds, minimum: 10 seconds).
6. Save the hook.

### Editing and deleting

- Click on an existing hook to edit its label, script path, type, or configuration.
- Use the delete button to remove a hook.

### Enable/disable toggle

Each hook has an enable/disable toggle. Disabled hooks are skipped during execution but remain configured on the profile.

### Display data

Display data returned by hooks (via the `display` output field) is shown on the profile detail view. Each key-value pair appears with its label and optional status color coding.

---

## Writing a Hook — Guide

### Basic template

```js
// my-hook.js
const ctx = JSON.parse(process.env.XOAY_HOOK_CONTEXT);

// Your logic here...
const result = doSomething();

// Return structured output (optional)
console.log(JSON.stringify({
  display: {
    myField: {
      value: result,
      label: 'My Label',
      status: 'ok' // 'ok' | 'warning' | 'error'
    }
  }
}));

// Exit code 0 = success, non-zero = failure
// Failures are logged but never block a switch
```

### Step by step

1. **Read the context:**
   ```js
   const ctx = JSON.parse(process.env.XOAY_HOOK_CONTEXT);
   // ctx.profileId, ctx.profileName, ctx.hookType, ctx.profile
   ```

2. **Do your work:** Run commands, read files, make HTTP requests — anything Node.js can do.

3. **Return structured output (optional):**
   ```js
   console.log(JSON.stringify({
     display: {
       key: { value: 'some value', label: 'Display Label', status: 'ok' }
     }
   }));
   ```

4. **Exit:** Exit with code 0 for success. Use `process.exit(1)` to indicate failure. Both are captured and shown in the UI.

### Tips

- **Keep hooks fast.** The default timeout is 30 seconds. Long-running hooks delay the switch flow.
- **Use `process.exit()`** to control the exit code. If your script just finishes, Node.js exits with code 0.
- **Avoid interactive input.** Hooks run headless with no terminal — `stdin` is not available.
- **Test locally** by setting the `XOAY_HOOK_CONTEXT` env var manually:
  ```bash
  XOAY_HOOK_CONTEXT='{"profileId":"test","profileName":"Test","hookType":"cron","profile":{"id":"test","name":"Test","items":[],"hooks":[]}}' node my-hook.js
  ```

### Full example: log-switch-time.js

```js
// Sample hook: logs the switch timestamp to a file and returns structured output
// Usage: attach this as a post-switch-in hook
const fs = require('fs');
const path = require('path');
const ctx = JSON.parse(process.env.XOAY_HOOK_CONTEXT || '{}');

const logFile = path.join(require('os').homedir(), '.xoay', 'switch-log.txt');
const timestamp = new Date().toISOString();
const line = `[${timestamp}] Switched to "${ctx.profileName}" (${ctx.hookType})\n`;

fs.mkdirSync(path.dirname(logFile), { recursive: true });
fs.appendFileSync(logFile, line);

// Structured output: app will parse this and display on profile UI
console.log(JSON.stringify({
  display: {
    lastSwitch: { value: timestamp, label: 'Last Switch' }
  }
}));
```

---

## Security

> **Hooks have full Node.js access.** There is no sandbox.

### What hooks can do

- Read and write any file the app process can access.
- Make network requests (HTTP, TCP, etc.).
- Spawn child processes.
- Access environment variables — including any API keys or tokens set in the app's environment.

### Your responsibilities

- **Only attach scripts you trust.** A malicious hook script has the same privileges as the app itself.
- **Review scripts before attaching.** Treat hook scripts like any executable you install on your machine.
- **Be cautious with shared profiles.** If you import a profile from someone else, their hook scripts are not included (only the script path is stored). You must attach your own scripts.

### Timeout protection

The app enforces a timeout on every hook execution (default: 30 seconds). If a hook exceeds the timeout:

1. The process receives `SIGTERM`.
2. After a 5-second grace period, the process is force-killed.
3. The hook is marked as failed with a timeout error.

This prevents runaway scripts from blocking the app indefinitely.
