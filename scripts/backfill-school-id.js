/**
 * One-shot backfill — populate school_id on existing SCHOOL accounts
 * from academy_registration, and re-run the pending-student promotion
 * hook for any school that now matches a pending student.
 *
 * Context: school signup captures the field as academy_registration,
 * but the pending-student promotion hook + schools-registry match
 * logic read school_id. A pre-save mirror on User now keeps them in
 * sync on every save, but existing rows pre-date that hook. This
 * script fixes those rows one time.
 *
 *   node scripts/backfill-school-id.js            # dry run
 *   node scripts/backfill-school-id.js --apply    # actually write
 */

const mongoose = require('mongoose');
const { getString } = require('@lykmapipo/env');

const APPLY = process.argv.includes('--apply');

async function main() {
  const uri = getString('MONGODB_URI');
  if (!uri) throw new Error('MONGODB_URI not set');
  await mongoose.connect(uri);
  const User = require('../src/User/user.model');

  const schools = await User.find({
    type: 'SCHOOL',
    academy_registration: { $exists: true, $ne: '' },
  });

  console.log(`SCHOOL accounts with academy_registration set: ${schools.length}`);

  let needsBackfill = 0;
  let alreadyAligned = 0;
  for (const s of schools) {
    const reg = (s.academy_registration || '').trim();
    const sid = (s.school_id || '').trim();
    if (reg && sid !== reg) {
      needsBackfill++;
      console.log(`  will fix ${s._id}: '${sid}' -> '${reg}'  (${s.academy_name || ''})`);
    } else {
      alreadyAligned++;
    }
  }
  console.log(`already aligned: ${alreadyAligned}`);
  console.log(`needs backfill:  ${needsBackfill}`);

  if (!APPLY) {
    console.log('\nDry run complete. Re-run with --apply to update.');
    await mongoose.disconnect();
    return;
  }

  let promoted = 0;
  for (const s of schools) {
    const reg = (s.academy_registration || '').trim();
    if (!reg) continue;
    if ((s.school_id || '').trim() === reg) continue;
    s.school_id = reg;
    // Clear the idempotency marker so the post-save promotion hook
    // runs for this school now that it has a school_id to match on.
    s.pendingPromotionDoneAt = null;
    await s.save();
    promoted++;
  }
  console.log(`\nSaved ${promoted} schools; promotion hook ran for each.`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
