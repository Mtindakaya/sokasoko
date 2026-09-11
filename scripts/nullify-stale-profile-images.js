/**
 * Nulls profileImage / academyPhoto / advertVideo / any other cached
 * media URL that points at the old Render local-disk path
 * (`https://sokasoko-backend.onrender.com/uploads/...` or
 *  `https://sokasoko.onrender.com/uploads/...`). Those URLs 410 now
 * that the /uploads static route is gone.
 *
 * Nulling them makes the client render the default avatar / empty
 * state cleanly instead of a broken image icon.
 *
 * Idempotent: only touches docs whose field starts with the legacy
 * host + /uploads path. Re-runs are safe.
 *
 * Run:  MONGODB_URI="mongodb+srv://..." node scripts/nullify-stale-profile-images.js
 */
require('dotenv').config();
const mongoose = require('mongoose');

const STALE_PATTERNS = [
  /^https?:\/\/sokasoko-backend\.onrender\.com\/uploads\//i,
  /^https?:\/\/sokasoko\.onrender\.com\/uploads\//i,
];

function isStale(url) {
  if (typeof url !== 'string' || url.length === 0) return false;
  return STALE_PATTERNS.some((rx) => rx.test(url));
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set');
    process.exit(1);
  }
  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  // Fields on User that might carry a Render /uploads URL. Extend
  // as more image-carrying fields are discovered.
  const USER_FIELDS = ['profileImage', 'advertVideo'];
  const users = db.collection('users');

  let cleaned = 0;
  for (const field of USER_FIELDS) {
    const rows = await users.find(
      { [field]: { $exists: true, $ne: null, $ne: '' } },
      { projection: { _id: 1, [field]: 1 } },
    ).toArray();
    for (const row of rows) {
      if (isStale(row[field])) {
        await users.updateOne(
          { _id: row._id },
          { $set: { [field]: null } },
        );
        cleaned++;
      }
    }
    console.log(`Users.${field}: swept ${rows.length} candidates, nulled ${cleaned}`);
  }

  // Advert cover images
  const adverts = db.collection('adverts');
  const advertRows = await adverts.find(
    { coverImage: { $exists: true, $ne: null, $ne: '' } },
    { projection: { _id: 1, coverImage: 1 } },
  ).toArray();
  let advCleaned = 0;
  for (const row of advertRows) {
    if (isStale(row.coverImage)) {
      await adverts.updateOne({ _id: row._id }, { $set: { coverImage: null } });
      advCleaned++;
    }
  }
  console.log(`Adverts.coverImage: swept ${advertRows.length} candidates, nulled ${advCleaned}`);

  // Media URLs (feed posts, playlist videos)
  const medias = db.collection('media');
  const mediaRows = await medias.find(
    { url: { $exists: true, $ne: null, $ne: '' } },
    { projection: { _id: 1, url: 1 } },
  ).toArray();
  let mediaCleaned = 0;
  for (const row of mediaRows) {
    if (isStale(row.url)) {
      // For media docs, nulling the url would break the post entirely
      // — better to mark it stale and let the client handle gracefully.
      await medias.updateOne(
        { _id: row._id },
        { $set: { url: null, urlStale: true } },
      );
      mediaCleaned++;
    }
  }
  console.log(`Media.url: swept ${mediaRows.length} candidates, marked stale ${mediaCleaned}`);

  console.log(`\nDone. Total: ${cleaned + advCleaned + mediaCleaned} stale URLs cleaned.`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error('nullify failed:', e.message);
  process.exit(1);
});
