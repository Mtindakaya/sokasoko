/**
 * School full-cycle test — walks a player and a brand-new school through
 * the whole P1 / P1.5 / P1.6 lifecycle:
 *
 *   Phase 1 — pending-school pick
 *     1. unlink the test player (clean slate)
 *     2. POST /join-school with pendingSchool* fields → player.school is
 *        null, player.pending_school_* set
 *     3. SCHOOL_PENDING notification lands on the player's inbox
 *
 *   Phase 2 — school registers
 *     4. POST /v1/users creates a SCHOOL with academy_registration =
 *        the same registration number the player picked
 *     5. post-save hook promotes the pending student: school = <new id>,
 *        pending fields cleared, pendingPromotionDoneAt stamped
 *     6. SCHOOL_PENDING_RESOLVED notification lands on the player's
 *        inbox
 *
 *   Phase 3 — sports teacher verify + roster
 *     7. POST /school-verify {verified:true} → flag flips
 *     8. SCHOOL_VERIFIED notification lands
 *     9. POST /school-roster {memberOnRoster:true} → flag flips
 *    10. SCHOOL_ROSTER_ADDED notification lands
 *
 *   Phase 4 — cleanup (always, best-effort)
 *    11. unlink the player
 *    12. tombstone the test school account (soft-delete flag)
 *
 * Env (all required unless marked optional):
 *   BASE_URL                https://sokasoko.onrender.com (default)
 *   PLAYER_ID               Mongo _id of a PLAYER test account
 *   TEST_SCHOOL_PHONE       phone to use when creating the test school
 *                           (must not clash with an existing account)
 *   TEST_SCHOOL_PASSWORD    optional; defaults to 'testpass'
 *   TEST_REG_NUMBER         optional; defaults to a timestamp-based
 *                           registration number so re-runs don't clash
 *   TEST_STAGE              optional; PRIMARY | SECONDARY | CHUO
 *                           (default SECONDARY)
 *   TEST_SCHOOL_NAME        optional; default
 *                           'E2E Test Secondary <timestamp>'
 *
 *   node scripts/test-school-full-cycle.js
 */

const https = require('https');
const http = require('http');

const BASE = process.env.BASE_URL || 'https://sokasoko.onrender.com';
const PLAYER_ID = process.env.PLAYER_ID || '';
const TEST_SCHOOL_PHONE = process.env.TEST_SCHOOL_PHONE || '';
const TEST_SCHOOL_PASSWORD = process.env.TEST_SCHOOL_PASSWORD || 'testpass';
const TEST_STAGE = (process.env.TEST_STAGE || 'SECONDARY').toUpperCase();
const TEST_REG_NUMBER = process.env.TEST_REG_NUMBER
  || `E2E-${Date.now()}`;
const TEST_SCHOOL_NAME = process.env.TEST_SCHOOL_NAME
  || `E2E Test ${TEST_STAGE} ${Date.now()}`;

if (!PLAYER_ID || !TEST_SCHOOL_PHONE) {
  console.error('Set PLAYER_ID + TEST_SCHOOL_PHONE (and optionally BASE_URL).');
  process.exit(2);
}

const GREEN = '\x1b[32m'; const RED = '\x1b[31m';
const YELLOW = '\x1b[33m'; const DIM = '\x1b[2m'; const RESET = '\x1b[0m';
let passed = 0; let failed = 0;
function pass(l, e) { passed++; console.log(`${GREEN}✓${RESET} ${l}${e ? `  ${DIM}${e}${RESET}` : ''}`); }
function fail(l, e) { failed++; console.log(`${RED}✗${RESET} ${l}`); if (e) console.log(`   ${RED}${e}${RESET}`); }

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

async function fetchPlayer() {
  const r = await request('GET', `/v1/users/${PLAYER_ID}`);
  if (r.status !== 200) throw new Error(`GET player → ${r.status}`);
  return r.body && r.body.data ? r.body.data : r.body;
}

async function findSelfJoinInInbox(userId, kind) {
  // Checks the user's inbox for a recent notification carrying
  // metadata.kind = <kind>. Returns the row or null.
  const r = await request('GET', `/v1/notifications/${userId}?limit=30`);
  if (r.status !== 200) return null;
  const rows = (r.body.data || r.body || []);
  return rows.find((n) => (n.metadata || {}).kind === kind) || null;
}

async function main() {
  console.log(`\n${DIM}Target:${RESET} ${BASE}`);
  console.log(`${DIM}Player:${RESET} ${PLAYER_ID}`);
  console.log(`${DIM}Test reg:${RESET} ${TEST_REG_NUMBER}`);
  console.log(`${DIM}Test stage:${RESET} ${TEST_STAGE}`);
  console.log(`${DIM}Test school name:${RESET} ${TEST_SCHOOL_NAME}\n`);

  let testSchoolId = null;

  try {
    // ── Phase 1 — pending-school pick ────────────────────────────────
    console.log(`${DIM}── Phase 1: pending school ──${RESET}`);

    await step('reset: unlink player from any prior school', async () => {
      const r = await request('DELETE',
        `/v1/users/${PLAYER_ID}/unlink-school`, { reason: 'full-cycle reset' });
      if (r.status !== 200) throw new Error(`DELETE unlink → ${r.status}`);
      return 'cleared';
    });

    await step('join-school pending — player tagged with pending_school_*',
      async () => {
        const r = await request('POST', `/v1/users/${PLAYER_ID}/join-school`, {
          pendingSchoolName: TEST_SCHOOL_NAME,
          pendingSchoolRegistrationNumber: TEST_REG_NUMBER,
          pendingSchoolStage: TEST_STAGE,
          schoolForm: TEST_STAGE === 'CHUO' ? null : 'FORM_2',
          collegeProgram: TEST_STAGE === 'CHUO' ? 'DEGREE' : null,
          collegeYear: TEST_STAGE === 'CHUO' ? 1 : null,
          studentRegistrationNumber: 'E2E-STUDENT-001',
        });
        if (r.status !== 200) {
          throw new Error(`POST /join-school → ${r.status}: ${JSON.stringify(r.body)}`);
        }
        const p = r.body.data;
        if (p.school) throw new Error('player.school should be null on pending');
        if (p.pending_school_registration_number !== TEST_REG_NUMBER) {
          throw new Error(`pending reg number mismatch: ${p.pending_school_registration_number}`);
        }
        if (p.pending_school_stage !== TEST_STAGE) {
          throw new Error(`pending stage mismatch: ${p.pending_school_stage}`);
        }
        return 'pending fields set';
      });

    await step('SCHOOL_PENDING notification on player inbox', async () => {
      const hit = await findSelfJoinInInbox(PLAYER_ID, 'SCHOOL_PENDING');
      if (!hit) throw new Error('no SCHOOL_PENDING notification');
      return 'notification present';
    });

    // ── Phase 2 — school registers ───────────────────────────────────
    console.log(`\n${DIM}── Phase 2: school registers ──${RESET}`);

    await step('create SCHOOL account with matching registration number',
      async () => {
        const r = await request('POST', '/v1/users', {
          type: 'SCHOOL',
          subAccount: 'false',
          academy_name: TEST_SCHOOL_NAME,
          academy_registration: TEST_REG_NUMBER,
          school_type: TEST_STAGE,
          phone: TEST_SCHOOL_PHONE,
          password: TEST_SCHOOL_PASSWORD,
        });
        if (r.status !== 200 && r.status !== 201) {
          throw new Error(`POST /v1/users → ${r.status}: ${JSON.stringify(r.body)}`);
        }
        testSchoolId = r.body._id || (r.body.data && r.body.data._id);
        if (!testSchoolId) throw new Error('no _id on create response');
        return `_id=${testSchoolId}`;
      });

    // Give the post-save hook a beat to run — it's awaited by the
    // User.save call but notification writes are fire-and-forget.
    await new Promise((r) => setTimeout(r, 1500));

    await step('promotion hook linked the pending player', async () => {
      const p = await fetchPlayer();
      const schoolRef = p.school && (p.school._id || p.school);
      if (String(schoolRef) !== String(testSchoolId)) {
        throw new Error(`player.school = ${schoolRef}, expected ${testSchoolId}`);
      }
      if (p.pending_school_registration_number) {
        throw new Error('pending_school_registration_number not cleared');
      }
      if (p.pending_school_name) {
        throw new Error('pending_school_name not cleared');
      }
      return 'school promoted';
    });

    await step('SCHOOL_PENDING_RESOLVED notification on player inbox',
      async () => {
        const hit = await findSelfJoinInInbox(PLAYER_ID,
          'SCHOOL_PENDING_RESOLVED');
        if (!hit) throw new Error('no SCHOOL_PENDING_RESOLVED notification');
        return 'notification present';
      });

    // ── Phase 3 — verify + roster ────────────────────────────────────
    console.log(`\n${DIM}── Phase 3: verify + roster ──${RESET}`);

    await step('school-verify {verified:true} flips the flag', async () => {
      const r = await request('POST',
        `/v1/users/${PLAYER_ID}/school-verify`, { verified: true });
      if (r.status !== 200) throw new Error(`POST /school-verify → ${r.status}`);
      if (r.body.data.school_verified_by_staff !== true) {
        throw new Error('flag did not flip');
      }
      return 'verified';
    });

    await step('SCHOOL_VERIFIED notification on player inbox', async () => {
      const hit = await findSelfJoinInInbox(PLAYER_ID, 'SCHOOL_VERIFIED');
      if (!hit) throw new Error('no SCHOOL_VERIFIED notification');
      return 'notification present';
    });

    await step('school-roster {memberOnRoster:true} promotes', async () => {
      const r = await request('POST',
        `/v1/users/${PLAYER_ID}/school-roster`, { memberOnRoster: true });
      if (r.status !== 200) throw new Error(`POST /school-roster → ${r.status}`);
      if (r.body.data.school_roster_member !== true) {
        throw new Error('roster flag did not flip');
      }
      return 'on roster';
    });

    await step('SCHOOL_ROSTER_ADDED notification on player inbox', async () => {
      const hit = await findSelfJoinInInbox(PLAYER_ID, 'SCHOOL_ROSTER_ADDED');
      if (!hit) throw new Error('no SCHOOL_ROSTER_ADDED notification');
      return 'notification present';
    });

    // ── Phase 4 — cleanup ────────────────────────────────────────────
    console.log(`\n${DIM}── Phase 4: cleanup ──${RESET}`);

    await step('unlink player back to clean state', async () => {
      const r = await request('DELETE',
        `/v1/users/${PLAYER_ID}/unlink-school`,
        { reason: 'full-cycle test cleanup' });
      if (r.status !== 200) throw new Error(`DELETE unlink → ${r.status}`);
      return 'cleared';
    });

    if (testSchoolId) {
      await step('delete the test school account', async () => {
        const r = await request('DELETE', `/v1/users/${testSchoolId}`);
        if (r.status !== 200 && r.status !== 204) {
          // Not fatal — surface as pending cleanup, don't fail the run.
          return `${YELLOW}DELETE → ${r.status} (manual cleanup needed)${RESET}`;
        }
        return 'deleted';
      });
    }
  } catch (err) {
    fail('fatal before cleanup', err && err.message);
    if (testSchoolId) {
      console.log(`\n${YELLOW}Note:${RESET} test school ${testSchoolId} may need manual cleanup.`);
    }
  }

  console.log();
  console.log(`${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`${RED}fatal:${RESET} ${err.message || err}`);
  process.exit(2);
});
