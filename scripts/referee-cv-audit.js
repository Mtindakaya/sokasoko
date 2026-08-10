/**
 * Audits referee CV coverage on the deployed database.
 * For every REFEREE account, counts how many COMPLETED matches they
 * appear on (as head ref OR either assistant) and how many of those
 * matches have at least one RefereeRating.
 *
 * Run:  node scripts/referee-cv-audit.js
 * No auth or DB creds needed — hits the deployed API only.
 */

const https = require('https');

const BASE = 'https://sokasoko.onrender.com';

function getJson(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    https.get({
      hostname: url.hostname,
      path: url.pathname + url.search,
      headers: { Accept: 'application/json' },
    }, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        if (res.statusCode >= 400) {
          return reject(new Error(`GET ${path} → ${res.statusCode}: ${raw.slice(0, 200)}`));
        }
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(new Error(`bad JSON from ${path}: ${e.message}`)); }
      });
    }).on('error', reject);
  });
}

async function main() {
  console.log(`Auditing referee CV coverage on ${BASE}\n`);

  // 1. Fetch every REFEREE account.
  const refsRes = await getJson('/v1/users?type=REFEREE&limit=500&includeOrphaned=1');
  const refs = refsRes.data || [];
  console.log(`Referees in DB: ${refs.length}`);
  if (refs.length === 0) {
    console.log('Nothing to audit.');
    return;
  }

  // 2. For each ref, pull their /refereeing feed and count.
  const rows = [];
  for (const r of refs) {
    let matches = [];
    try {
      const res = await getJson(`/v1/matches/refereeing/${r._id}`);
      matches = res.data || [];
    } catch (e) {
      console.log(`  ! ${r.accountNumber || r._id}: ${e.message}`);
      continue;
    }
    const totals = { total: matches.length, mainRef: 0, asst1: 0, asst2: 0, rated: 0 };
    for (const m of matches) {
      if (m.myRole === 'REFEREE') totals.mainRef++;
      else if (m.myRole === 'ASSISTANT_1') totals.asst1++;
      else if (m.myRole === 'ASSISTANT_2') totals.asst2++;
      if (m.rating && m.rating.gamesRated > 0) totals.rated++;
    }
    rows.push({
      name: `${r.firstName || ''} ${r.lastName || ''}`.trim() || '(no name)',
      account: r.accountNumber || r._id,
      ...totals,
    });
  }

  // 3. Sort by total desc and print.
  rows.sort((a, b) => b.total - a.total);
  const withMatches = rows.filter((r) => r.total > 0);
  const empty = rows.length - withMatches.length;

  console.log(`Referees with ≥1 COMPLETED match: ${withMatches.length}`);
  console.log(`Referees with zero matches:       ${empty}\n`);

  const header = ['Ref', 'Account', 'Total', 'Main', 'Asst1', 'Asst2', 'Rated'];
  const widths = [22, 16, 6, 5, 6, 6, 6];
  const pad = (v, w) => String(v).slice(0, w).padEnd(w);
  console.log(header.map((h, i) => pad(h, widths[i])).join(' '));
  console.log(widths.map((w) => '-'.repeat(w)).join(' '));
  for (const r of withMatches) {
    console.log([
      pad(r.name, widths[0]),
      pad(r.account, widths[1]),
      pad(r.total, widths[2]),
      pad(r.mainRef, widths[3]),
      pad(r.asst1, widths[4]),
      pad(r.asst2, widths[5]),
      pad(r.rated, widths[6]),
    ].join(' '));
  }

  // 4. Aggregate numbers so testers know what they'll see.
  const totalCompletedRows = withMatches.reduce((s, r) => s + r.total, 0);
  const totalRatedRows     = withMatches.reduce((s, r) => s + r.rated, 0);
  console.log(`\nAcross all refs: ${totalCompletedRows} match rows, ${totalRatedRows} carry a rating.`);

  const nearThreshold = withMatches.filter((r) => r.total >= 8 && r.total < 10);
  const atThreshold   = withMatches.filter((r) => r.total >= 10);
  if (nearThreshold.length) {
    console.log(`\n${nearThreshold.length} ref(s) are at 8-9 games (the warning band):`);
    nearThreshold.forEach((r) => console.log(`  ${r.name} (${r.account}) — ${r.total}`));
  }
  if (atThreshold.length) {
    console.log(`\n${atThreshold.length} ref(s) are at ≥10 games (subscription would be enforced):`);
    atThreshold.forEach((r) => console.log(`  ${r.name} (${r.account}) — ${r.total}`));
  }
}

main().catch((e) => {
  console.error('audit failed:', e.message);
  process.exit(1);
});
