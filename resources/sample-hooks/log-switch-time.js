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
    lastSwitch: { value: timestamp, label: "Last Switch" }
  }
}));
