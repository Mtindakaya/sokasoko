// Find (and optionally delete) duplicate Ifakara Football Academy
// accounts. Case-insensitive academy_name match, plus some variants
// (with/without the word "Football").
//
// Usage:
//   node scripts/find-ifakara-duplicates.js               # list only
//   node scripts/find-ifakara-duplicates.js --delete-all  # actually delete
require('dotenv').config();
const mongoose = require('mongoose');
require('../src/Academy/academy.model');
const User = require('../src/User/user.model');

const MONGO_URL = process.env.MONGO_URL
  || process.env.MONGODB_URI
  || 'mongodb://localhost:27017/sokasoko';

async function main() {
  const doDelete = process.argv.includes('--delete-all');
  await mongoose.connect(MONGO_URL);

  const rows = await User.find({
    academy_name: { $regex: /ifakara/i },
  })
    .select('_id firstName lastName academy_name company_name accountNumber phone type createdAt')
    .sort({ createdAt: 1 })
    .lean();

  console.log(`Found ${rows.length} account(s) whose academy_name contains "ifakara":`);
  for (const r of rows) {
    console.log(
      `  ${r.accountNumber || '(no acct)'}  ·  ` +
      `${r.academy_name || '(no academy name)'}  ·  ` +
      `phone ${r.phone || '(none)'}  ·  ` +
      `type ${r.type}  ·  ` +
      `created ${new Date(r.createdAt).toISOString().slice(0, 10)}  ·  ` +
      `_id ${r._id}`
    );
  }

  if (!doDelete) {
    console.log(`\n(list only — re-run with --delete-all to remove all ${rows.length})`);
    await mongoose.disconnect();
    process.exit(0);
  }

  console.log(`\nDeleting all ${rows.length} record(s)...`);
  const ids = rows.map((r) => r._id);
  const res = await User.deleteMany({ _id: { $in: ids } });
  console.log(`Deleted ${res.deletedCount} document(s).`);
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => { console.error(err.stack || err.message); process.exit(1); });
