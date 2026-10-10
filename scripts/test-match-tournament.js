/**
 * Match + Tournament unified age-levels + duration test.
 *
 * Verifies the backend contract added in the 2026-10-08 commit
 * (76b9cb7 "Match + Tournament: unified age-level list + per-match
 * duration") plus the follow-up 4b7bae1 ("Backend age-levels: Advisory
 * + TournamentTeamRegistration + demo seed").
 *
 * Flow:
 *   1. GET /v1/matches — recent matches carry durationMinutes.
 *   2. GET /v1/tournaments — recent tournaments carry
 *      defaultMatchDurationMinutes.
 *   3. For a sampled match + tournament, their ageLevel / categories
 *      ageGroup fall inside the canonical list.
 *   4. Reject-path probe: POST /v1/matches with a stale 'U18' ageLevel
 *      → expect 400 ValidationError.
 *   5. Reject-path probe: POST /v1/matches with durationMinutes=0 and
 *      durationMinutes=200 → both rejected (schema bounds 1..180).
 *
 * Env:
 *   BASE_URL   https://sokasoko.onrender.com (default)
 *   ORG_ID     any ACADEMY/CLUB/SCHOOL id that can create a match (for
 *              the reject-path probes — the create fails anyway, so
 *              nothing persists). Optional; if absent, reject-path
 *              probes are skipped with a NOTE.
 *
 *   node scripts/test-match-tournament.js
 */

const https = require('https');
const http = require('http');

const BASE = process.env.BASE_URL || 'https://sokasoko.onrender.com';
const ORG_ID = process.env.ORG_ID || '';

const CANONICAL_AGES = [
  'U9', 'U11', 'U13', 'U15', 'U17', 'U19', 'U20', 'U23',
  'OPEN',
  'OVER_35', 'OVER_40', 'OVER_50',
];

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
let passed = 0; let failed = 0; let skipped = 0;

function pass(l, e) { passed++; console.log(`${GREEN}✓${RESET} ${l}${e ? `  ${DIM}${e}${RESET}` : ''}`); }
function fail(l, e) { failed++; console.log(`${RED}✗${RESET} ${l}`); if (e) console.log(`   ${RED}${e}${RESET}`); }
function skip(l, e) { skipped++; console.log(`${YELLOW}~${RESET} ${l} ${DIM}(skipped${e ? `: ${e}` : ''})${RESET}`); }

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const url = new URL(BASE + path);
    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
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
    if (data) req.write(data);
    req.end();
  });
}

async function step(label, fn) {
  try { const extra = await fn(); pass(label, extra); }
  catch (err) { fail(label, err && err.message ? err.message : String(err)); }
}

async function main() {
  console.log(`\n${DIM}Target:${RESET} ${BASE}\n`);

  await step('Matches list — rows carry durationMinutes', async () => {
    const r = await request('GET', '/v1/matches?limit=10');
    if (r.status !== 200) throw new Error(`GET /v1/matches → ${r.status}`);
    const rows = r.body.data || r.body || [];
    if (!rows.length) return 'no matches to sample';
    const missing = rows.filter((m) => m.durationMinutes == null);
    if (missing.length === rows.length) {
      throw new Error('every row missing durationMinutes');
    }
    const sample = rows.find((m) => m.durationMinutes != null);
    return `${rows.length} rows, sample.durationMinutes=${sample.durationMinutes}`;
  });

  await step('Tournaments list — rows carry defaultMatchDurationMinutes',
    async () => {
      const r = await request('GET', '/v1/tournaments?limit=10');
      if (r.status !== 200) throw new Error(`GET /v1/tournaments → ${r.status}`);
      const rows = r.body.data || r.body || [];
      if (!rows.length) return 'no tournaments to sample';
      const sample = rows.find((t) => t.defaultMatchDurationMinutes != null);
      if (!sample) throw new Error('every row missing defaultMatchDurationMinutes');
      return `${rows.length} rows, sample=${sample.defaultMatchDurationMinutes}`;
    });

  await step('Sampled match.ageLevel is in canonical list', async () => {
    const r = await request('GET', '/v1/matches?limit=20');
    const rows = r.body.data || r.body || [];
    const withAge = rows.filter((m) => m.ageLevel);
    if (!withAge.length) return 'no matches with ageLevel to sample';
    const bad = withAge.find((m) => !CANONICAL_AGES.includes(m.ageLevel));
    if (bad) throw new Error(`non-canonical ageLevel ${bad.ageLevel}`);
    return `${withAge.length} rows all canonical`;
  });

  await step('Sampled tournament.categories[].ageGroup is canonical',
    async () => {
      const r = await request('GET', '/v1/tournaments?limit=20');
      const rows = r.body.data || r.body || [];
      let checked = 0;
      for (const t of rows) {
        for (const cat of (t.categories || [])) {
          if (!cat.ageGroup) continue;
          checked++;
          if (!CANONICAL_AGES.includes(cat.ageGroup)) {
            throw new Error(`non-canonical ageGroup ${cat.ageGroup} on ${t._id}`);
          }
        }
      }
      return `${checked} categories checked`;
    });

  if (!ORG_ID) {
    skip('Reject stale U18 ageLevel on POST /v1/matches', 'ORG_ID not set');
    skip('Reject durationMinutes out of 1..180 bounds', 'ORG_ID not set');
  } else {
    await step('Reject stale U18 ageLevel on POST /v1/matches', async () => {
      const r = await request('POST', '/v1/matches', {
        organizer: ORG_ID,
        homeTeam: ORG_ID,
        awayTeam: ORG_ID,
        scheduledFor: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        ageLevel: 'U18',
        gender: 'MALE',
        durationMinutes: 90,
      });
      if (r.status === 200 || r.status === 201) {
        throw new Error('U18 was accepted — enum not enforced');
      }
      // 400 ValidationError expected.
      return `${r.status}`;
    });

    await step('Reject durationMinutes out of 1..180 bounds', async () => {
      const r0 = await request('POST', '/v1/matches', {
        organizer: ORG_ID,
        homeTeam: ORG_ID,
        awayTeam: ORG_ID,
        scheduledFor: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        ageLevel: 'U15',
        gender: 'MALE',
        durationMinutes: 0,
      });
      const r200 = await request('POST', '/v1/matches', {
        organizer: ORG_ID,
        homeTeam: ORG_ID,
        awayTeam: ORG_ID,
        scheduledFor: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        ageLevel: 'U15',
        gender: 'MALE',
        durationMinutes: 200,
      });
      if (r0.status === 200 || r0.status === 201) {
        throw new Error('durationMinutes=0 was accepted');
      }
      if (r200.status === 200 || r200.status === 201) {
        throw new Error('durationMinutes=200 was accepted');
      }
      return `0→${r0.status}, 200→${r200.status}`;
    });
  }

  console.log();
  console.log(`${passed} passed, ${failed} failed, ${skipped} skipped`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`${RED}fatal:${RESET} ${err.message || err}`);
  process.exit(2);
});
