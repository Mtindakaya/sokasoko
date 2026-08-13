/**
 * Seed a real PLATINUM subscription for a given vendor via the public API.
 *
 * Usage:
 *   node scripts/seed-vendor-platinum.js <accountNumber>
 *
 * Example:
 *   node scripts/seed-vendor-platinum.js TFH-V-A000126
 *
 * Flow:
 *   1. Look up the vendor by accountNumber (GET /v1/users?type=VENDOR&limit=500).
 *   2. POST /v1/subscriptions {userType:VENDOR, tier:PLATINUM, plan:MONTHLY} → PENDING.
 *   3. POST /v1/subscriptions/:id/activate → ACTIVE.
 *   4. Print effective tier snapshot so we can confirm.
 *
 * Safe to re-run — if a matching ACTIVE subscription already exists the
 * activation step will still return a valid doc.
 */

const https = require('https');

const BASE = 'https://sokasoko.onrender.com';

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const url = new URL(BASE + path);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };
    const request = https.request(options, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        try {
          const json = raw ? JSON.parse(raw) : {};
          if (res.statusCode >= 400) {
            return reject(new Error(`${method} ${path} → ${res.statusCode}: ${raw}`));
          }
          resolve(json);
        } catch (e) {
          reject(new Error(`Bad JSON from ${path}: ${raw}`));
        }
      });
    });
    request.on('error', reject);
    if (data) request.write(data);
    request.end();
  });
}

async function main() {
  const accountNumber = process.argv[2];
  if (!accountNumber) {
    console.error('usage: node scripts/seed-vendor-platinum.js <accountNumber>');
    process.exit(1);
  }
  console.log(`[1/4] locating vendor ${accountNumber}…`);
  const list = await req('GET', '/v1/users?type=VENDOR&limit=500');
  const vendors = list.data || [];
  const match = vendors.find((v) => v.accountNumber === accountNumber);
  if (!match) {
    console.error(`no vendor with accountNumber=${accountNumber}. Available:`);
    vendors.forEach((v) => console.error(`  ${v.accountNumber}  ${v.company_name || `${v.firstName || ''} ${v.lastName || ''}`.trim()}`));
    process.exit(2);
  }
  console.log(`     → ${match._id}  ${match.company_name || match.firstName + ' ' + match.lastName}`);

  console.log('[2/4] creating PENDING PLATINUM subscription…');
  const sub = await req('POST', '/v1/subscriptions', {
    user: match._id,
    userType: 'VENDOR',
    tier: 'PLATINUM',
    plan: 'MONTHLY',
    paymentMethod: 'MANUAL',
    transactionId: 'DEMO-SEED-PLATINUM',
    notes: 'Seeded for demo — remove before external testers.',
  });
  const created = sub.data || sub.subscription || sub;
  const subId = created._id;
  console.log(`     → subscription ${subId} status=${created.status}`);

  console.log('[3/4] activating…');
  const activated = await req('POST', `/v1/subscriptions/${subId}/activate`, {
    adminUserId: null,
  });
  console.log(`     → status=${activated.status}  endDate=${activated.endDate}`);

  console.log('[4/4] verifying effective tier via /subscriptions/me…');
  const me = await req('GET', `/v1/subscriptions/me?userId=${match._id}&userType=VENDOR`);
  console.log(`     → effective tier=${me.tier}`);
  const cap = me.usage && me.usage.features && me.usage.features.homeFeedPosts && me.usage.features.homeFeedPosts.cap;
  console.log(`     → homeFeedPosts cap=${cap} (expected 75 for PLATINUM)`);
  if (me.tier !== 'PLATINUM') {
    console.error('WARNING: effective tier did not resolve to PLATINUM. Investigate.');
    process.exit(3);
  }
  console.log('done.');
}

main().catch((e) => { console.error(e.message); process.exit(9); });
