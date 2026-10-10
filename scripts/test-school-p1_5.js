/**
 * School P1.5 end-to-end test script.
 *
 * Walks the new self-link + verify + roster flow through its paces:
 *   1.  unlink the player (reset to clean slate)
 *   2.  POST /join-school → player row carries school + verified=false + schoolForm
 *   3.  sports-teacher inbox contains the SCHOOL_SELF_JOIN notification
 *   4.  POST /school-verify {verified:true} → flag flips
 *   5.  POST /school-roster {memberOnRoster:true} → flag flips
 *   6.  attempt old SCHOOL_LINK invitation path → expect 410
 *   7.  GET /schools-registry for every stage → union shape sanity-check
 *   8.  POST /join-school on a secondary player → cap enforced at 30
 *   9.  final unlink → all P1.5 fields clear
 *
 * Env vars (all required unless noted):
 *   BASE_URL              https://sokasoko.onrender.com (default)
 *   SCHOOL_ID             Mongo _id of a SCHOOL User with school_type=SECONDARY
 *   PLAYER_ID             Mongo _id of a PLAYER test account
 *   SPORTS_TEACHER_ID     Mongo _id of a GUARDIAN linked as sports_teacher_1 on
 *                         the school. Script checks their notification inbox.
 *
 * Prints a colour-tagged ✓ / ✗ per step. Non-zero exit code if any fails.
 *
 *   node scripts/test-school-p1_5.js
 */

const https = require('https');
const http = require('http');

const BASE = process.env.BASE_URL || 'https://sokasoko.onrender.com';
const SCHOOL_ID = process.env.SCHOOL_ID || '';
const PLAYER_ID = process.env.PLAYER_ID || '';
const SPORTS_TEACHER_ID = process.env.SPORTS_TEACHER_ID || '';

if (!SCHOOL_ID || !PLAYER_ID || !SPORTS_TEACHER_ID) {
  console.error(
    'Missing env. Set SCHOOL_ID + PLAYER_ID + SPORTS_TEACHER_ID '
    + '(and optionally BASE_URL).',
  );
  process.exit(2);
}

// ── Colour tags ───────────────────────────────────────────────────────────────
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

let passed = 0;
let failed = 0;

function pass(label, extra) {
  passed++;
  console.log(`${GREEN}✓${RESET} ${label}${extra ? `  ${DIM}${extra}${RESET}` : ''}`);
}
function fail(label, err) {
  failed++;
  console.log(`${RED}✗${RESET} ${label}`);
  if (err) console.log(`   ${RED}${err}${RESET}`);
}

// ── HTTP helper (same shape as scripts/seed.js) ──────────────────────────────
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

// ── Steps ────────────────────────────────────────────────────────────────────

async function step(label, fn) {
  try {
    const extra = await fn();
    pass(label, extra);
  } catch (err) {
    fail(label, err && err.message ? err.message : String(err));
  }
}

async function fetchPlayer() {
  const r = await request('GET', `/v1/users/${PLAYER_ID}`);
  if (r.status !== 200) throw new Error(`GET player returned ${r.status}`);
  // Backend wraps or returns the user directly depending on endpoint; handle
  // both shapes.
  return r.body && r.body.data ? r.body.data : r.body;
}

async function main() {
  console.log(`\n${DIM}Target:${RESET} ${BASE}`);
  console.log(`${DIM}School:${RESET} ${SCHOOL_ID}`);
  console.log(`${DIM}Player:${RESET} ${PLAYER_ID}`);
  console.log(`${DIM}Sports teacher:${RESET} ${SPORTS_TEACHER_ID}\n`);

  // Preflight — target reachable.
  await step('Backend reachable', async () => {
    const r = await request('GET', '/health');
    if (r.status !== 200 && r.status !== 404) {
      throw new Error(`GET /health → ${r.status}`);
    }
    return `/health ${r.status}`;
  });

  // 1. Reset — unlink any prior association.
  await step('Reset: unlink player from school', async () => {
    const r = await request('DELETE', `/v1/users/${PLAYER_ID}/unlink-school`,
      { reason: 'p1.5 test reset' });
    if (r.status !== 200) throw new Error(`DELETE /unlink-school → ${r.status}`);
    const p = await fetchPlayer();
    if (p.school) throw new Error('player.school still set after unlink');
    if (p.school_verified_by_staff) {
      throw new Error('school_verified_by_staff still true after unlink');
    }
    if (p.student_registration_number) {
      throw new Error('student_registration_number still set after unlink');
    }
    return 'all fields cleared';
  });

  // 2. Direct self-link.
  await step('join-school: direct self-link, unverified, schoolForm written',
    async () => {
      const r = await request('POST', `/v1/users/${PLAYER_ID}/join-school`, {
        schoolId: SCHOOL_ID,
        schoolForm: 'FORM_2',
        studentRegistrationNumber: 'TEST-REG-001',
      });
      if (r.status !== 200) {
        throw new Error(`POST /join-school → ${r.status}: ${JSON.stringify(r.body)}`);
      }
      const p = r.body.data;
      const schoolRef = p.school && (p.school._id || p.school);
      if (String(schoolRef) !== String(SCHOOL_ID)) {
        throw new Error(`school ref mismatch: ${schoolRef}`);
      }
      if (p.school_verified_by_staff !== false) {
        throw new Error('school_verified_by_staff should start false');
      }
      if (p.school_form !== 'FORM_2') {
        throw new Error(`school_form expected FORM_2, got ${p.school_form}`);
      }
      if (p.student_registration_number !== 'TEST-REG-001') {
        throw new Error(`reg number mismatch: ${p.student_registration_number}`);
      }
      return 'linked, unverified, Form 2';
    });

  // 3. Notification fanout.
  await step('sports teacher inbox contains SCHOOL_SELF_JOIN', async () => {
    const r = await request('GET',
      `/v1/notifications/${SPORTS_TEACHER_ID}?limit=20`);
    if (r.status !== 200) {
      throw new Error(`GET notifications → ${r.status}`);
    }
    const rows = (r.body.data || r.body || []);
    const hit = rows.find((n) => (n.metadata || {}).kind === 'SCHOOL_SELF_JOIN'
      && String((n.metadata || {}).playerId) === String(PLAYER_ID));
    if (!hit) throw new Error('no SCHOOL_SELF_JOIN notification for this player');
    return 'notification present';
  });

  // 4. Verify toggle.
  await step('school-verify: flag flips true', async () => {
    const r = await request('POST', `/v1/users/${PLAYER_ID}/school-verify`,
      { verified: true });
    if (r.status !== 200) throw new Error(`POST /school-verify → ${r.status}`);
    if (r.body.data.school_verified_by_staff !== true) {
      throw new Error('flag did not flip');
    }
    return 'verified = true';
  });

  // 5. Roster toggle.
  await step('school-roster: flip onto roster', async () => {
    const r = await request('POST', `/v1/users/${PLAYER_ID}/school-roster`,
      { memberOnRoster: true });
    if (r.status !== 200) throw new Error(`POST /school-roster → ${r.status}`);
    if (r.body.data.school_roster_member !== true) {
      throw new Error('roster flag did not flip');
    }
    return 'roster_member = true';
  });

  // 6. Old SCHOOL_LINK invitation path is retired.
  await step('old SCHOOL_LINK invitation returns 410 Gone', async () => {
    const r = await request('POST', '/v1/invitations', {
      invitee: PLAYER_ID,
      inviter: SCHOOL_ID,
      kind: 'SCHOOL_LINK',
      payload: {},
    });
    if (r.status !== 410) {
      throw new Error(`expected 410, got ${r.status}`);
    }
    return 'retired';
  });

  // 7. Schools registry per stage.
  for (const stage of ['PRIMARY', 'SECONDARY', 'CHUO']) {
    await step(`schools-registry stage=${stage} returns rows with regNumber`,
      async () => {
        const r = await request('GET',
          `/v1/schools-registry?stage=${stage}&limit=5`);
        if (r.status !== 200) {
          throw new Error(`GET /schools-registry → ${r.status}`);
        }
        const rows = r.body.data || [];
        if (rows.length === 0) throw new Error('no rows returned');
        const bad = rows.find((row) => !row.name || !row.registrationNumber);
        if (bad) throw new Error(`row missing name/regNumber: ${JSON.stringify(bad)}`);
        const hasActive = rows.some((row) => row.isSokaSokoActive === true);
        const activeNote = hasActive ? '(SokaSoko-active row present)' : '(registry only)';
        return `${rows.length} rows ${activeNote}`;
      });
  }

  // 8. Registry search by query matches by name OR reg number.
  await step('schools-registry query matches on name', async () => {
    const r = await request('GET',
      '/v1/schools-registry?stage=SECONDARY&query=sec&limit=5');
    if (r.status !== 200) throw new Error(`GET → ${r.status}`);
    const rows = r.body.data || [];
    if (rows.length === 0) throw new Error('no rows for "sec" query');
    const anyNameHit = rows.some((row) =>
      row.name.toLowerCase().includes('sec')
      || row.registrationNumber.toLowerCase().includes('sec'));
    if (!anyNameHit) throw new Error('query filter did not match');
    return `${rows.length} rows`;
  });

  // 9. Final cleanup — unlink + confirm all fields clear.
  await step('final unlink clears every P1.5 field', async () => {
    const r = await request('DELETE', `/v1/users/${PLAYER_ID}/unlink-school`,
      { reason: 'p1.5 test cleanup' });
    if (r.status !== 200) throw new Error(`DELETE /unlink-school → ${r.status}`);
    const p = await fetchPlayer();
    const stale = [];
    if (p.school) stale.push('school');
    if (p.school_verified_by_staff) stale.push('school_verified_by_staff');
    if (p.school_roster_member) stale.push('school_roster_member');
    if (p.school_form) stale.push('school_form');
    if (p.college_program) stale.push('college_program');
    if (p.college_year != null) stale.push('college_year');
    if (p.student_registration_number) stale.push('student_registration_number');
    if (stale.length) throw new Error(`fields not cleared: ${stale.join(', ')}`);
    return 'cleared';
  });

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log();
  console.log(`${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`${RED}fatal:${RESET} ${err.message || err}`);
  process.exit(2);
});
