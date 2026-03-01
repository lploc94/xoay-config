// Codex CLI quota check hook — hybrid session log + API approach
// Primary: parses Codex session logs for rate limit info (fast, local)
// Fallback: calls ChatGPT backend API when no session data available
//
// Output format:
//   { display: { quota: {...}, quotaDetail: {...}, source: {...} }, actions: { switchToNextProfile: bool } }

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

// ─── Output builders ───

function buildOutput(primaryUsed, secondaryUsed, source) {
  const maxUsed = Math.max(primaryUsed, secondaryUsed);
  const remaining = Math.round(100 - maxUsed);
  const status = getStatus(maxUsed);

  return {
    display: {
      quota: { value: `${remaining}%`, label: 'Codex Remaining', status },
      quotaDetail: { value: `5h: ${primaryUsed}% | wk: ${secondaryUsed}%`, label: 'Usage', status },
      source: { value: source, label: 'Data Source', status: 'ok' },
    },
    actions: {
      switchToNextProfile: maxUsed >= THRESHOLD_AUTO_SWITCH,
    },
  };
}

function buildNoDataOutput(detail) {
  return {
    display: {
      quota: { value: 'N/A', label: 'Codex Remaining', status: 'ok' },
      quotaDetail: { value: detail, label: 'Usage', status: 'ok' },
      source: { value: 'None', label: 'Data Source', status: 'ok' },
    },
  };
}

// ─── Main ───

async function main() {
  // Step 1: Try session log first (fast, local, no network)
  const sessionFile = findLatestSessionFile();
  let sessionRateLimits = null;
  if (sessionFile) {
    sessionRateLimits = parseSessionFile(sessionFile);
    if (sessionRateLimits) {
      // Check if data is still valid (primary window hasn't reset)
      const primaryResetsAt = sessionRateLimits.primary.resets_at;
      const nowSec = Math.floor(Date.now() / 1000);

      if (primaryResetsAt && nowSec < primaryResetsAt) {
        // Data is still within the current window — use it
        console.log(JSON.stringify(buildOutput(
          sessionRateLimits.primary.used_percent,
          sessionRateLimits.secondary.used_percent,
          'Session Log'
        )));
        return;
      }
      // Data is stale (window has reset) — fall through to API
    }
  }

  // Step 2: Fallback to API (requires network)
  try {
    const apiData = await fetchQuotaViaAPI();
    if (apiData && apiData.rate_limit) {
      const rl = apiData.rate_limit;
      const primaryUsed = rl.primary_window ? rl.primary_window.used_percent : 0;
      const secondaryUsed = rl.secondary_window ? rl.secondary_window.used_percent : 0;
      console.log(JSON.stringify(buildOutput(primaryUsed, secondaryUsed, 'API')));
      return;
    }
  } catch {
    // API failed — fall through
  }

  // Step 3: API failed — use stale session data if we have it (better than nothing)
  if (sessionRateLimits) {
    console.log(JSON.stringify(buildOutput(
      sessionRateLimits.primary.used_percent,
      sessionRateLimits.secondary.used_percent,
      'Session Log (stale)'
    )));
    return;
  }

  // Step 4: Nothing available
  console.log(JSON.stringify(buildNoDataOutput('No data available')));
}

main();
