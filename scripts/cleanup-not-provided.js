/**
 * One-shot backfill — flip legacy "Not Provided" sentinel values on
 * contact / social fields to empty string, so Info Zaidi stops hiding
 * them.
 *
 * Context: mobile User.fromJson used to default these fields to the
 * literal string 'Not Provided' when the backend returned null. The
 * Edit Profile form started with that string as the field value, and
 * if a user tapped Save without typing over it, the string got
 * persisted. The display path hides any field equal to 'Not Provided',
 * so the data looks like it was never saved.
 *
 * Fixed on 2026-10-12 (user.dart default + user.http.router.js PATCH
 * scrub). This script cleans the rows that already carry the sentinel.
 *
 *   node scripts/cleanup-not-provided.js            # dry run
 *   node scripts/cleanup-not-provided.js --apply    # actually write
 */

const mongoose = require('mongoose');
const { getString } = require('@lykmapipo/env');

const APPLY = process.argv.includes('--apply');
const FIELDS = [
  'email', 'contact_number', 'street', 'facebook', 'instagram',
  'twitter', 'youtube', 'linkedin', 'fifaId', 'license_level',
  'education_level',
];

async function main() {
  const uri = getString('MONGODB_URI');
  if (!uri) throw new Error('MONGODB_URI not set');
  await mongoose.connect(uri);
  const User = require('../src/User/user.model');

  const or = FIELDS.map((f) => ({ [f]: 'Not Provided' }));
  const matchFilter = { $or: or };

  const total = await User.countDocuments(matchFilter);
  console.log(`Users with at least one 'Not Provided' field: ${total}`);

  // Per-field count for visibility.
  for (const f of FIELDS) {
    const n = await User.countDocuments({ [f]: 'Not Provided' });
    if (n) console.log(`  ${f.padEnd(18)} ${n}`);
  }

  if (!APPLY) {
    console.log('\nDry run complete. Re-run with --apply to update.');
    await mongoose.disconnect();
    return;
  }

  // One updateMany per field — avoids $set with 10 keys per doc.
  let changed = 0;
  for (const f of FIELDS) {
    const result = await User.updateMany(
      { [f]: 'Not Provided' },
      { $set: { [f]: '' } },
    );
    const n = result.modifiedCount || result.nModified || 0;
    if (n) console.log(`updated ${n.toString().padStart(5)} rows on ${f}`);
    changed += n;
  }
  console.log(`\nTotal field updates: ${changed}`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
