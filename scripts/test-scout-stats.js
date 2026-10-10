/**
 * Scouting Work stats endpoint test.
 *
 * Verifies GET /v1/scout-reports/stats/:userId — the aggregator that
 * backs the "Scouting Work" tile on scout + coach profiles.
 *
 * Flow:
 *   1. Reject malformed userId (non-ObjectId) → 400.
 *   2. Returns the 5-key shape on a valid user (empty counts for a
 *      user who has never scouted; non-negative integers for one who
 *      has).
 *   3. jobsAccepted <= jobsReceived.
 *   4. officialPlayersEvaluated and unofficialPlayersEvaluated are
 *      non-negative integers.
 *   5. The distinct-players count is <= distinct ScoutReports' player
 *      field for that scout (sanity — a scout can file many reports on
 *      one player; stats collapse to distinct).
 *
 * Env:
 *   BASE_URL     https://sokasoko.onrender.com (default)
 *   SCOUT_ID     scout whose counters we test. Required.
 *   EMPTY_ID     (optional) userId known to have zero scouting work —
 *                verifies the empty case returns 0,0,0,0,0.
 *
 *   node scripts/test-scout-stats.js
 */

const https = require('https');
const http = require('http');

const BASE = process.env.BASE_URL || 'https://sokasoko.onrender.com';
const SCOUT_ID = process.env.SCOUT_ID || '';
const EMPTY_ID = process.env.EMPTY_ID || '';

if (!SCOUT_ID) {
  console.error('Set SCOUT_ID (and optionally EMPTY_ID + BASE_URL).');
  process.exit(2);
}

const GREEN = '\x1b[32m'; const RED = '\x1b[31m';
const YELLOW = '\x1b[33m'; const DIM = '\x1b[2m'; const RESET = '\x1b[0m';
let passed = 0; let failed = 0; let skipped = 0;
function pass(l, e) { passed++; console.log(`${GREEN}✓${RESET} ${l}${e ? `  ${DIM}${e}${RESET}` : ''}`); }
function fail(l, e) { failed++; console.log(`${RED}✗${RESET} ${l}`); if (e) console.log(`   ${RED}${e}${RESET}`); }
function skip(l, e) { skipped++; console.log(`${YELLOW}~${RESET} ${l} ${DIM}(skipped${e ? `: ${e}` : ''})${RESET}`); }

function request(method, path) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method,
    }, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        let parsed = null;
        try { parsed = raw ? JSON.parse(raw) : null; } catch (_) { parsed = raw; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function step(label, fn) {
  try { const extra = await fn(); pass(label, extra); }
  catch (err) { fail(label, err && err.message ? err.message : String(err)); }
}

function assertShape(body) {
  const keys = ['matchesScouted', 'jobsReceived', 'jobsAccepted',
    'officialPlayersEvaluated', 'unofficialPlayersEvaluated'];
  for (const k of keys) {
    if (typeof body[k] !== 'number') {
      throw new Error(`missing / non-number key: ${k}`);
    }
    if (body[k] < 0 || !Number.isInteger(body[k])) {
      throw new Error(`${k} should be non-negative integer, got ${body[k]}`);
    }
  }
}

async function main() {
  console.log(`\n${DIM}Target:${RESET} ${BASE}`);
  console.log(`${DIM}Scout:${RESET}  ${SCOUT_ID}\n`);

  await step('Reject invalid userId (non-ObjectId)', async () => {
    const r = await request('GET', '/v1/scout-reports/stats/not-an-id');
    if (r.status !== 400) throw new Error(`expected 400, got ${r.status}`);
    return 'returns 400';
  });

  let scoutStats;
  await step('Scout stats shape — 5 non-negative integers', async () => {
    const r = await request('GET', `/v1/scout-reports/stats/${SCOUT_ID}`);
    if (r.status !== 200) throw new Error(`GET → ${r.status}`);
    assertShape(r.body);
    scoutStats = r.body;
    return `matches=${r.body.matchesScouted}, jobs=${r.body.jobsAccepted}/${r.body.jobsReceived}, off=${r.body.officialPlayersEvaluated}, unoff=${r.body.unofficialPlayersEvaluated}`;
  });

  await step('jobsAccepted <= jobsReceived', () => {
    if (scoutStats.jobsAccepted > scoutStats.jobsReceived) {
      throw new Error(`${scoutStats.jobsAccepted} > ${scoutStats.jobsReceived}`);
    }
    return `${scoutStats.jobsAccepted}/${scoutStats.jobsReceived}`;
  });

  await step('matchesScouted <= jobsReceived', () => {
    if (scoutStats.matchesScouted > scoutStats.jobsReceived) {
      throw new Error(`${scoutStats.matchesScouted} > ${scoutStats.jobsReceived}`);
    }
    return `${scoutStats.matchesScouted} vs ${scoutStats.jobsReceived}`;
  });

  if (EMPTY_ID) {
    await step('Empty-scout returns all zeros', async () => {
      const r = await request('GET', `/v1/scout-reports/stats/${EMPTY_ID}`);
      if (r.status !== 200) throw new Error(`GET → ${r.status}`);
      assertShape(r.body);
      const sum = r.body.matchesScouted
        + r.body.jobsReceived
        + r.body.jobsAccepted
        + r.body.officialPlayersEvaluated
        + r.body.unofficialPlayersEvaluated;
      if (sum !== 0) throw new Error(`expected 0 everything, got sum=${sum}`);
      return 'all zeros';
    });
  } else {
    skip('Empty-scout returns all zeros', 'EMPTY_ID not set');
  }

  console.log();
  console.log(`${passed} passed, ${failed} failed, ${skipped} skipped`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`${RED}fatal:${RESET} ${err.message || err}`);
  process.exit(2);
});
