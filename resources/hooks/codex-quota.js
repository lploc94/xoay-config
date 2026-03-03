// Codex CLI quota check hook — API-first with session log fallback
// Primary: calls ChatGPT backend API for authoritative quota data
// Fallback: parses Codex session logs when API unavailable (normal mode only)
// Fresh switch: outputs "Fetching..." status if API fails
//
// Output format (HookOutput with DisplayItem[]):
//   display: [percentage(quota), key-value(usage), status(source), text?(reset time)]
//   actions: { switchToNextProfile, notify? }

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');

const CODEX_DIR = path.join(os.homedir(), '.codex');
const AUTH_FILE = path.join(CODEX_DIR, 'auth.json');
const SESSIONS_DIR = path.join(CODEX_DIR, 'sessions');

const THRESHOLD_WARNING = 70;
const THRESHOLD_ERROR = 90;
const THRESHOLD_AUTO_SWITCH = 95;

function getStatus(usedPercent) {
  if (usedPercent >= THRESHOLD_ERROR) return 'error';
  if (usedPercent >= THRESHOLD_WARNING) return 'warning';
  return 'ok';
}

function clampPercent(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0;
}

// ─── HTTPS helpers (Node.js built-in only) ───

function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, headers: res.headers, body: data });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ─── Auth helpers ───

function readAuth() {
  try {
    const raw = fs.readFileSync(AUTH_FILE, 'utf-8');
    const auth = JSON.parse(raw);
    if (auth.auth_mode !== 'chatgpt') return null;
    const t = auth.tokens;
    if (!t || !t.access_token || !t.account_id) return null;
    return auth;
  } catch {
    return null;
  }
}

// ─── API calls ───

function fetchUsage(accessToken, accountId) {
  return httpsRequest({
    hostname: 'chatgpt.com',
    path: '/backend-api/wham/usage',
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'ChatGPT-Account-Id': accountId,
      'User-Agent': 'codex-cli',
    },
  });
}

async function fetchQuotaViaAPI() {
  const auth = readAuth();
  if (!auth) return null;

  let res;
  try {
    res = await fetchUsage(auth.tokens.access_token, auth.tokens.account_id);
  } catch {
    return null;
  }

  if (res.statusCode !== 200) return null;

  try {
    return JSON.parse(res.body);
  } catch {
    return null;
  }
}

// ─── Session log parsing (fallback) ───

function findLatestSessionFile() {
  if (!fs.existsSync(SESSIONS_DIR)) return null;

  let years;
  try {
    years = fs.readdirSync(SESSIONS_DIR).filter((d) => /^\d{4}$/.test(d)).sort().reverse();
  } catch {
    return null;
  }

  for (const year of years) {
    const yearDir = path.join(SESSIONS_DIR, year);
    let months;
    try {
      months = fs.readdirSync(yearDir).filter((d) => /^\d{2}$/.test(d)).sort().reverse();
    } catch {
      continue;
    }

    for (const month of months) {
      const monthDir = path.join(yearDir, month);
      let days;
      try {
        days = fs.readdirSync(monthDir).filter((d) => /^\d{2}$/.test(d)).sort().reverse();
      } catch {
        continue;
      }

      for (const day of days) {
        const dayDir = path.join(monthDir, day);
        let files;
        try {
          files = fs
            .readdirSync(dayDir)
            .filter((f) => f.startsWith('rollout-') && f.endsWith('.jsonl'))
            .sort()
            .reverse();
        } catch {
          continue;
        }

        if (files.length > 0) {
          return path.join(dayDir, files[0]);
        }
      }
    }
  }

  return null;
}

function parseSessionFile(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }

  const lines = content.trim().split('\n');
  let lastRateLimits = null;

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      if (
        record.type === 'event_msg' &&
        record.payload &&
        record.payload.type === 'token_count'
      ) {
        const rateLimits = record.payload.rate_limits || (record.payload.info && record.payload.info.rate_limits);
        if (rateLimits && rateLimits.primary && rateLimits.secondary) {
          lastRateLimits = rateLimits;
        }
      }
    } catch {
      // Skip malformed lines
    }
  }

  return lastRateLimits;
}

// ─── Output helpers ───

function formatDuration(resetsAtSec) {
  const ts = Number(resetsAtSec);
  if (!Number.isFinite(ts)) return null;
  const nowSec = Math.floor(Date.now() / 1000);
  const diff = ts - nowSec;
  if (diff < 0) return null;
  if (diff < 60) return '< 1m';
  const hours = Math.floor(diff / 3600);
  const minutes = Math.floor((diff % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

// ─── Output builders ───

function buildOutput(primaryUsed, secondaryUsed, source, resetsAt) {
  const pUsed = clampPercent(primaryUsed);
  const sUsed = clampPercent(secondaryUsed);
  const maxUsed = Math.max(pUsed, sUsed);
  const remaining = Math.round(100 - maxUsed);
  const status = getStatus(maxUsed);

  const display = [
    { type: 'percentage', label: 'Codex Remaining', value: remaining, max: 100, status, span: 'full' },
    { type: 'key-value', label: 'Usage Breakdown', value: null, entries: { '5h window': `${pUsed}%`, 'Weekly': `${sUsed}%` }, status },
    { type: 'status', label: 'Data Source', value: source, status: 'ok' },
  ];

  if (resetsAt != null) {
    const duration = formatDuration(resetsAt);
    if (duration) {
      display.push({ type: 'text', label: 'Resets In', value: duration, status: 'ok' });
    }
  }

  return {
    display,
    actions: {
      switchToNextProfile: maxUsed >= THRESHOLD_AUTO_SWITCH,
      notify: maxUsed >= THRESHOLD_ERROR ? `Quota critically low (${remaining}% remaining)` : undefined,
    },
  };
}

function buildNoDataOutput(detail) {
  return {
    display: [
      { type: 'status', label: 'Codex Quota', value: detail, status: 'ok' }
    ]
  };
}

// ─── Hook context ───

function parseHookContext() {
  const raw = process.env.XOAY_HOOK_CONTEXT;
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function debugLog(msg) {
  if (process.env.XOAY_DEBUG === '1') {
    process.stderr.write(`[codex-quota] ${msg}\n`);
  }
}

// ─── Main ───

async function main() {
  const ctx = parseHookContext();
  const freshSwitch = ctx.freshSwitch === true;

  // Step 1: Try API first (authoritative for current account)
  try {
    const apiData = await fetchQuotaViaAPI();
    if (apiData && apiData.rate_limit) {
      const rl = apiData.rate_limit;
      const primaryUsed = rl.primary_window ? rl.primary_window.used_percent : 0;
      const secondaryUsed = rl.secondary_window ? rl.secondary_window.used_percent : 0;
      const resetsAt = rl.primary_window ? rl.primary_window.resets_at : undefined;
      debugLog('source=api reason=api_success');
      console.log(JSON.stringify(buildOutput(primaryUsed, secondaryUsed, 'API', resetsAt)));
      return;
    }
    debugLog('source=api reason=api_no_rate_limit');
  } catch {
    debugLog('source=api reason=api_error');
  }

  // Step 2: API failed — if freshSwitch, output "Fetching" status
  if (freshSwitch) {
    debugLog('source=none reason=fresh_switch_api_failed');
    console.log(JSON.stringify({
      display: [
        { type: 'status', label: 'Codex Quota', value: 'Fetching quota...', status: 'ok' }
      ]
    }));
    return;
  }

  // Step 3: Normal mode — fall back to session log
  const sessionFile = findLatestSessionFile();
  if (sessionFile) {
    const sessionRateLimits = parseSessionFile(sessionFile);
    if (sessionRateLimits) {
      const primaryResetsAt = sessionRateLimits.primary.resets_at;
      const nowSec = Math.floor(Date.now() / 1000);
      const stale = primaryResetsAt && nowSec >= primaryResetsAt;
      const source = stale ? 'Session Log (stale)' : 'Session Log';
      debugLog(`source=session reason=api_unavailable stale=${stale}`);
      console.log(JSON.stringify(buildOutput(
        sessionRateLimits.primary.used_percent,
        sessionRateLimits.secondary.used_percent,
        source,
        primaryResetsAt
      )));
      return;
    }
  }

  // Step 4: Nothing available
  debugLog('source=none reason=no_data');
  console.log(JSON.stringify(buildNoDataOutput('No data available')));
}

main();
