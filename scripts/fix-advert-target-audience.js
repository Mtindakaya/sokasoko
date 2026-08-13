/**
 * One-off fix: adverts saved before the JSON-string parsing fix store
 * targetAudience as a one-element [String] array wrapping a JSON blob,
 * e.g. `["[\"PLAYER\",\"GUARDIAN\"]"]`. Rewrite each such row so the
 * mongo filter `targetAudience: <userType>` matches again.
 *
 * Reads directly via mongoose using the same MONGO_URI the backend uses.
 * Run:  node scripts/fix-advert-target-audience.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const Advert = require('../src/Advert/advert.model');

async function main() {
  const uri = process.env.MONGODB_URI
    || process.env.MONGO_URI
    || 'mongodb://localhost:27017/sokasoko';
  console.log('connecting…', uri.replace(/:\/\/[^@]+@/, '://<creds>@'));
  await mongoose.connect(uri);

  const ads = await Advert.find({}).lean();
  let fixed = 0;
  for (const ad of ads) {
    const ta = ad.targetAudience;
    if (!Array.isArray(ta) || ta.length !== 1) continue;
    const first = ta[0];
    if (typeof first !== 'string' || !first.trim().startsWith('[')) continue;
    let parsed;
    try {
      parsed = JSON.parse(first);
    } catch (_) {
      continue;
    }
    if (!Array.isArray(parsed)) continue;
    console.log(`  ${ad._id}  "${ad.title}"  → ${JSON.stringify(parsed)}`);
    await Advert.updateOne({ _id: ad._id }, { $set: { targetAudience: parsed } });
    fixed += 1;
  }
  console.log(`fixed ${fixed} adverts.`);
  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
