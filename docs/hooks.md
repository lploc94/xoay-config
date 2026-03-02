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
    execSync(`git stash push -m "xoay-auto:  
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
const line = `[ 
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
        value: ` 
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
const line = `[ 
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
        value: ` 
```

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
│  2.5. Apply configUpdates from pre-switch-out hooks                 │
│       └─ Hooks can return configUpdates to sync files from disk    │
│                                                                     │
│  3. post-switch-out hooks (OLD profile)                             │
│     └─ Config updates applied, old config about to be replaced     │
│                                                                     │
│  4. switchEngine.switch(newProfile)                                 │
│     └─ Config files are replaced/applied here                      │
│                                                                     │
│  5. pre-switch-in hooks (NEW profile)                               │
│     └─ New config applied, but activeProfileId not yet updated     │
│                                                                     │
│  6. Update activeProfileId                                          │
│     └─ Profile is now officially active                            │
│                                                                     │
│  7. post-switch-in hooks (NEW profile)                              │
│     └─ Profile fully active, safe to query status                  │
│                                                                     │
│  8. Start cron hooks (NEW profile)                                  │
│     └─ Periodic hooks begin running on their intervals             │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Key points:**

- Steps 2 and 3 run hooks from the **old** profile. Steps 5 and 7 run hooks from the **new** profile.
- Step 2.5 applies `configUpdates` returned by pre-switch-out hooks — this is how the built-in `sync-config.js` hook syncs file changes from disk back to stored profile data.
- All hooks are best-effort — a failure at any step does not block the switch.
- Hook results from all steps are collected and displayed in the switch result dialog.
- Steps 5-8 only run if the switch engine succeeds (step 4).

## Input — Hook Context

Every hook receives context about the current operation via the `XOAY_HOOK_CONTEXT` environment variable. The value is a JSON string.

### Reading the context

```js
const ctx = JSON.parse(process.env.XOAY_HOOK_CONTEXT);
```

### Context structure

**Switch hook example** (`post-switch-in`):

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

**Cron hook example** — first run after a profile switch (`freshSwitch: true`):

```json
{
  "profileId": "abc-123",
  "profileName": "Work Account",
  "hookType": "cron",
  "freshSwitch": true,
  "previousProfileId": "def-456",
  "previousProfileName": "Personal Account",
  "trigger": "switch",
  "profile": { "..." }
}
```

**Cron hook example** — startup (app launch, no switch occurred):

```json
{
  "profileId": "abc-123",
  "profileName": "Work Account",
  "hookType": "cron",
  "trigger": "startup",
  "profile": { "..." }
}
```

> **Note:** `freshSwitch` is omitted (`undefined`) on startup because no switch occurred — the cron was started at boot.

**Cron hook example** — normal scheduled run (no recent switch):

```json
{
  "profileId": "abc-123",
  "profileName": "Work Account",
  "hookType": "cron",
  "freshSwitch": false,
  "trigger": "schedule",
  "profile": { "..." }
}
```

> **Note:** `freshSwitch`, `previousProfileId`, `previousProfileName`, and `trigger` are only set on cron hooks. `previousProfileId` and `previousProfileName` are only present when `freshSwitch` is `true`.

### Fields

| Field | Type | Description |
| --- | --- | --- |
| profileId | string | ID of the profile this hook belongs to |
| profileName | string | Human-readable name of the profile |
| hookType | string | One of: pre-switch-out, post-switch-out, pre-switch-in, post-switch-in, cron |
| profile | object | Full profile object including items and hooks |
| freshSwitch | boolean \| undefined | `true` on the first cron run after an account switch. `false` on subsequent scheduled cron runs. Omitted (`undefined`) on startup crons and absent for non-cron hooks. Use this to detect that shared resources (session logs, caches) may belong to the previous profile. |
| previousProfileId | string \| undefined | ID of the profile that was switched away from. Only present when `freshSwitch` is `true`. |
| previousProfileName | string \| undefined | Human-readable name of the profile that was switched away from. Only present when `freshSwitch` is `true`. |
| trigger | `"switch"` \| `"startup"` \| `"schedule"` \| undefined | What caused this hook execution. `"switch"` = profile switch, `"startup"` = app launch (profile crons started at boot), `"schedule"` = normal cron interval. Absent for non-cron hooks. |

> **Backward compatibility:** All four new fields (`freshSwitch`, `previousProfileId`, `previousProfileName`, `trigger`) are optional. Existing hooks that do not reference these fields continue to work without changes.

### Handling fresh switches in cron hooks

When a profile switch occurs, the first cron run for the new profile has `freshSwitch: true`. This signals that shared resources — such as session logs, cache files, or database connections — may still reference the **previous** profile's data. Hooks should use this flag to avoid acting on stale data.

```js
// cron-quota-check.js — Handles fresh switch by resetting cached data
const ctx = JSON.parse(process.env.XOAY_HOOK_CONTEXT);

if (ctx.freshSwitch) {
  // First run after a switch — shared resources may be stale.
  // Clear any cached data that belongs to the previous profile.
  console.log(JSON.stringify({
    display: [
      {
        type: 'status',
        label: 'Quota',
        value: 'Refreshing…',
        status: 'warning'
      }
    ]
  }));
  // Optionally log which profile we came from:
  // ctx.previousProfileId, ctx.previousProfileName
  process.exit(0);
}

// Normal cron run — safe to use cached/shared resources
checkQuota().then((remaining) => {
  console.log(JSON.stringify({
    display: [
      {
        type: 'percentage',
        label: 'API Quota',
        value: remaining,
        max: 5000,
        status: remaining < 500 ? 'error' : remaining < 2000 ? 'warning' : 'ok'
      }
    ]
  }));
});
```

**When is `trigger` useful?** Use `trigger` to distinguish how a cron hook was started:

- `"switch"` — The cron started because a profile switch just completed. `freshSwitch` is `true`.
- `"startup"` — The cron started at app launch (profile crons started at boot). `freshSwitch` is omitted (`undefined`/falsy).
- `"schedule"` — A normal interval tick. `freshSwitch` is `false`.

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
  },
  "configUpdates": [
    { "itemId": "item-1", "content": "updated file content..." }
  ]
}
```

### `display` — UI Data

Each key in `display` is a named field shown on the profile detail view.

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| value | string | null | Yes | The display value. Set to null to remove this field. |
| label | string | No | Human-readable label (e.g., "API Quota"). Defaults to the key name. |
| status | "ok" | "warning" | "error" | No | Color coding for the value. |

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
| --- | --- | --- |
| switchToNextProfile | boolean | Switch to the next profile in the list (circular order) |
| switchToProfile | string | Switch to a specific profile by ID (overrides switchToNextProfile) |
| notify | string | Show an inline notification with a custom message |

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

### `configUpdates` — Modify Profile Items

Hooks can return a `configUpdates` array to update profile config items (e.g., sync file content from disk). Each entry targets a specific item by ID and provides the new content or value.

```json
{
  "configUpdates": [
    { "itemId": "item-1", "content": "new file content..." },
    { "itemId": "item-2", "value": "new-env-value" }
  ]
}
```

| Property | Type | Description |
| --- | --- | --- |
| itemId | string | ID of the config item to update |
| content | string | New content for `file-replace` items |
| value | string | New value for `env-var` items |

**How it works:**

- Config updates are processed during the switch flow, after `pre-switch-out` hooks run (step 2.5 in the lifecycle diagram).
- The app matches each `itemId` to the profile's items and updates the stored content/value.
- Only `file-replace` items accept `content`, and only `env-var` items accept `value`. Mismatches are logged and skipped.
- This mechanism replaces the old anchor-based sync system — hooks now handle all config syncing explicitly.

**Use case:** The built-in `sync-config.js` hook uses `configUpdates` to read files from disk before a switch-out and update the stored profile data with any changes the user made externally.

### Non-JSON output

If your script writes non-JSON text to stdout, it is simply ignored. The hook still succeeds or fails based on its exit code. This means you can safely use `console.log()` for debugging during development — just make sure your final output is the JSON line if you want structured data.

## Cron Hooks

Cron hooks run on a repeating interval while their profile is active.

### Configuration

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| cronIntervalMs | number | 60000 (1 min) | Interval in milliseconds between runs |
| timeout | number | 30000 (30s) | Maximum execution time per run |

**Minimum interval:** 10 seconds (10,000 ms). Values below this are clamped to 10 seconds.

### Lifecycle

1. **Start:** Cron hooks start automatically when their profile becomes active (after `post-switch-in` hooks complete). **The first run happens immediately** — the hook does not wait for the interval to elapse.
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
        value: result.ok ? 'Healthy' : `Down ( 
```

## Background Cron Hooks

By default, cron hooks only run while their profile is the **active** profile. When you switch away, they stop. Background cron hooks change this — they run for **all profiles simultaneously**, regardless of which profile is currently active.

### Enabling background mode

Set `runInBackground: true` on a cron hook (in the hook edit UI or via the `hook:add` / `hook:update` IPC channels):

```ts
{
  type: 'cron',
  runInBackground: true,
  cronIntervalMs: 60000,
  // ...other hook fields
}
```

### How it differs from regular cron

| Behavior | Regular cron | Background cron (`runInBackground: true`) |
| --- | --- | --- |
| Starts when | Profile becomes active | App startup (for every profile) |
| Stops when | Profile switches away or app quits | App quits |
| Affected by profile switching | Yes — stops on switch-out, starts on switch-in | No — keeps running across switches |
| Runs for | Active profile only | All profiles with background cron hooks |

### Lifecycle

1. **App startup:** The app scans all profiles and starts background cron hooks for every profile that has at least one enabled cron hook with `runInBackground: true`. The first run happens immediately — it does not wait for the interval.
2. **Running:** Each background cron hook runs independently on its own `setInterval`, just like regular crons. Multiple background hooks across multiple profiles can run concurrently.
3. **Profile switching:** Background crons are **not affected** by profile switches. Regular (non-background) crons stop and start as usual.
4. **App quit:** All background crons stop on the `before-quit` event.

### Use case: monitoring across all accounts

The primary use case is monitoring quota or usage across all accounts at once. For example, you have 5 API accounts and want to see each account's remaining quota in real-time — even when only one account is actively in use.

```js
// quota-monitor.js — Background cron hook
// Checks API quota for this profile's account, regardless of active state
const https = require('https');
const ctx = JSON.parse(process.env.XOAY_HOOK_CONTEXT);

// Each profile's hook runs with its own context, so ctx.profile
// contains that specific profile's config items and credentials
const apiKey = ctx.profile.items
  .find(i => i.type === 'env-var' && i.name === 'API_KEY')?.value;

if (!apiKey) process.exit(0);

https.get(`https://api.example.com/quota?key=${apiKey}`, (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    const quota = JSON.parse(data);
    console.log(JSON.stringify({
      display: [
        {
          type: 'text',
          label: 'API Quota',
          value: `${quota.remaining}/${quota.limit}`,
          status: quota.remaining < 100 ? 'error' : quota.remaining < 500 ? 'warning' : 'ok'
        }
      ]
    }));
  });
}).on('error', () => process.exit(1));
```

## Rich Display Types

Hooks can return structured display data that the app renders in the Status Card grid. There are 6 display types, each optimized for a different kind of data.

### Output format

The new display format uses an array of `DisplayItem` objects:

```json
{
  "display": [
    { "type": "text", "label": "Account", "value": "user@example.com" },
    { "type": "percentage", "label": "Quota Used", "value": 75, "max": 100, "status": "warning" },
    { "type": "status", "label": "API Health", "value": "Healthy", "status": "ok" }
  ]
}
```

### Display types

#### `text`

Plain text display. The default and most common type.

```json
{ "type": "text", "label": "Account", "value": "user@example.com" }
```

#### `number`

Numeric value display.

```json
{ "type": "number", "label": "Requests Today", "value": 1542 }
```

#### `percentage`

A value out of a maximum. Use `max` to set the upper bound (default: 100).

```json
{ "type": "percentage", "label": "Quota Used", "value": 75, "max": 100, "status": "warning" }
```

#### `status`

A status indicator with color coding.

```json
{ "type": "status", "label": "API Health", "value": "Operational", "status": "ok" }
```

#### `key-value`

Multiple key-value pairs in a single card. Use the `entries` field.

```json
{
  "type": "key-value",
  "label": "Rate Limits",
  "value": "3 limits",
  "entries": {
    "Requests/min": "60",
    "Requests/hour": "1000",
    "Requests/day": "10000"
  }
}
```

#### `html`

Raw HTML content for custom rendering. Use with caution — only use with trusted scripts.

```json
{ "type": "html", "label": "Custom", "value": "<strong>Bold text</strong>" }
```

### Grid layout with `span`

Each display item can specify a `span` to control how many columns it occupies in the 3-column Status Card grid:

| Span value | Columns | Use for |
| --- | --- | --- |
| `1` (default) | 1 of 3 | Single values, short text |
| `2` | 2 of 3 | Medium content, key-value pairs |
| `3` | 3 of 3 | Wide content |
| `"full"` | Full width | HTML content, large tables |

```json
{
  "display": [
    { "type": "text", "label": "Account", "value": "user@example.com", "span": 2 },
    { "type": "status", "label": "Status", "value": "Active", "status": "ok", "span": 1 },
    { "type": "key-value", "label": "Limits", "value": "Details", "entries": { "RPM": "60", "RPD": "10000" }, "span": "full" }
  ]
}
```

### DisplayItem fields

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| type | `"text"` \| `"number"` \| `"percentage"` \| `"status"` \| `"key-value"` \| `"html"` | Yes | Display type |
| label | string | Yes | Human-readable label shown below the value |
| value | string \| number \| null | Yes | The display value. `null` removes this item. |
| max | number | No | For `percentage` type — the max value (default: 100) |
| status | `"ok"` \| `"warning"` \| `"error"` | No | Color coding: green, yellow, red |
| entries | Record\<string, string\> | No | For `key-value` type — the key-value pairs |
| span | `1` \| `2` \| `3` \| `"full"` | No | Grid column span (default: 1) |

### Backward compatibility

The old `Record<string, HookDisplayValue>` format is still supported. The app automatically converts it to the new `DisplayItem[]` format at runtime:

**Old format (still works):**

```json
{
  "display": {
    "quota": { "value": "1500/5000", "label": "API Quota", "status": "ok" },
    "lastCheck": { "value": "2025-06-15 14:30", "label": "Last Check" }
  }
}
```

This is automatically converted to:

```json
{
  "display": [
    { "type": "text", "label": "API Quota", "value": "1500/5000", "status": "ok" },
    { "type": "text", "label": "Last Check", "value": "2025-06-15 14:30" }
  ]
}
```

When the old format is detected (an object instead of an array), each key-value pair is converted to a `text` type `DisplayItem`. The `label` defaults to the object key name if not specified. All old fields (`value`, `label`, `status`) are preserved.

> **Recommendation:** Use the new array format for new hooks. It gives you access to all 6 display types, the `span` layout control, and the `entries` field for key-value data.

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

### Display Data in the UI

Display data returned by hooks (via the `display` output field) appears in several places across the app.

#### Status Card

The primary display area is the **Status Card** — a grid at the top of the profile detail view. Each key in the `display` output renders as a cell containing:

- **Value** — the main text (e.g., `"1500/5000"`), color-coded by status: green (`ok`), yellow (`warning`), red (`error`).
- **Label** — smaller text below the value (defaults to the key name if not specified).
- **Status border** — a colored left border matching the status.

The grid uses up to **3 columns** per row and wraps automatically when there are more than 3 fields.

#### "Updated X ago" timestamp

Below the Status Card, a timestamp shows when hooks last produced display data for this profile (e.g., "Updated 2m ago"). This timestamp:

- Is stored **per profile** in `electron-store` (`hookDisplayTimestamps[profileId]`).
- **Persists across app restarts** — navigating between profiles or restarting the app preserves it.
- Only updates when a hook actually runs and produces new `display` data (via `mergeDisplayData()`).
- Refreshes its relative time label every 10 seconds in the UI.

#### Sidebar badges

When a cron hook returns display data, the **first display value** for the active profile is shown as a small badge on the profile's sidebar entry. The badge shows the value text with a background color matching the status (`ok` = green, `warning` = yellow, `error` = red). Only the active profile in each category shows a badge.

#### Tray menu

The system tray menu also shows display data for active profiles. When a profile has display data, the tray menu item shows the profile name followed by the first display value in parentheses (e.g., `"Work Account (1500/5000)"`). Warning and error statuses are prefixed with a `⚠` symbol.

#### Persistence

All display data and timestamps are stored in `electron-store` and survive app restarts. The data is updated incrementally via merge semantics — only fields present in new hook output are updated, and fields not included are left unchanged. Setting a value to `null` explicitly removes that field.

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

1. **Read the context:**`const ctx = JSON.parse(process.env.XOAY_HOOK_CONTEXT);
// ctx.profileId, ctx.profileName, ctx.hookType, ctx.profile`
2. **Do your work:** Run commands, read files, make HTTP requests — anything Node.js can do.
3. **Return structured output (optional):**`console.log(JSON.stringify({
  display: {
    key: { value: 'some value', label: 'Display Label', status: 'ok' }
  }
}));`
4. **Exit:** Exit with code 0 for success. Use `process.exit(1)` to indicate failure. Both are captured and shown in the UI.

### Tips

- **Keep hooks fast.** The default timeout is 30 seconds. Long-running hooks delay the switch flow.
- **Use **`process.exit()` to control the exit code. If your script just finishes, Node.js exits with code 0.
- **Avoid interactive input.** Hooks run headless with no terminal — `stdin` is not available.
- **Test locally** by setting the `XOAY_HOOK_CONTEXT` env var manually:` ' node my-hook.js`

### Full example: log-switch-time.js

```js
// Sample hook: logs the switch timestamp to a file and returns structured output
// Usage: attach this as a post-switch-in hook
const fs = require('fs');
const path = require('path');
const ctx = JSON.parse(process.env.XOAY_HOOK_CONTEXT || '{}');

const logFile = path.join(require('os').homedir(), '.xoay', 'switch-log.txt');
const timestamp = new Date().toISOString();
const line = `[ 
```

## Built-in Hooks

Built-in hooks are scripts that ship with the app and are automatically attached to new profiles. They provide essential functionality like config syncing.

### How built-in hooks work

- **Auto-attached:** When you create a new profile, the app automatically adds all built-in hooks to it.
- **Disable-only:** Built-in hooks can be disabled (toggled off) but cannot be deleted. The delete button is hidden in the UI.
- **"Built-in" badge:** Built-in hooks display a "Built-in" badge in the hook edit dialog to distinguish them from user hooks.
- **`builtIn` flag:** In the data model, built-in hooks have `builtIn: true` on the `ProfileHook` object.
- **Script resolution:** Built-in hook scripts use the `builtin/` prefix in their `scriptPath` (e.g., `builtin/sync-config.js`). The app resolves this to the bundled `resources/hooks/` directory.

### `sync-config.js` — Config Sync Hook

The `sync-config.js` built-in hook replaces the old anchor-based sync system. It runs as a `pre-switch-out` hook and reads config files from disk to detect changes made while the profile was active.

**What it does:**

1. Iterates over all enabled items in the current profile.
2. For `file-replace` items: reads the target file from disk and compares it to the stored content.
3. For `env-var` items: reads the shell config file, extracts the variable value, and compares it to the stored value.
4. Returns a `configUpdates` array with any changes found.

**Output format:**

```json
{
  "configUpdates": [
    { "itemId": "item-1", "content": "updated file content from disk" },
    { "itemId": "item-2", "value": "updated-env-value" }
  ]
}
```

**Why this matters:** If you edit a config file (e.g., `~/.aws/credentials`) while a profile is active, the sync hook captures those edits before switching away. Without it, your manual changes would be lost because the app only stores the content from when you last switched in.

**Migration from anchor-sync:** In previous versions, config items had an `anchor` field and the app used a dedicated `anchor-sync` module to detect file changes. This has been replaced entirely by the `sync-config.js` hook, which provides the same functionality through the standard hook system. The `anchor` field has been removed from config items.

## Security

> Hooks have full Node.js access. There is no sandbox.

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