/**
 * One-off migration: drops the old {match:1, ratedBy:1} unique index on
 * the refereeratings collection and lets Mongoose recreate the new
 * {match:1, ratedBy:1, referee:1} unique index at next connect.
 *
 * Runs against MONGODB_URI in the environment. Safe to run repeatedly —
 * it only drops the old index if it still exists.
 *
 * Run:  MONGODB_URI="mongodb+srv://..." node scripts/fix-rating-index.js
 */

const mongoose = require('mongoose');

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set');
    process.exit(1);
  }
  await mongoose.connect(uri);
  const coll = mongoose.connection.collection('refereeratings');
  const indexes = await coll.indexes();
  const stale = indexes.find(
    (i) => i.key && i.key.match === 1 && i.key.ratedBy === 1 && !i.key.referee
  );
  if (stale) {
    console.log(`Dropping stale index: ${stale.name}`);
    await coll.dropIndex(stale.name);
  } else {
    console.log('No stale index found — nothing to drop.');
  }
  // Ensure the new compound index exists.
  await coll.createIndex(
    { match: 1, ratedBy: 1, referee: 1 },
    { unique: true, name: 'match_1_ratedBy_1_referee_1' }
  );
  console.log('New compound index in place.');
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error('migration failed:', e.message);
  process.exit(1);
});
