// Fuzzy phone/account search — pass a partial and it looks for anything
// that contains it. Debug helper only.
require('dotenv').config();
const mongoose = require('mongoose');
require('../src/Academy/academy.model');
const User = require('../src/User/user.model');

const MONGO_URL = process.env.MONGO_URL
  || process.env.MONGODB_URI
  || 'mongodb://localhost:27017/sokasoko';

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: node scripts/find-user.js <partial-phone-or-account>');
    process.exit(1);
  }
  await mongoose.connect(MONGO_URL);
  const escaped = arg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rows = await User.find({
    $or: [
      { phone: { $regex: escaped } },
      { accountNumber: { $regex: escaped } },
    ],
  }).select('firstName lastName company_name accountNumber phone type').limit(20).lean();
  console.log(`Found ${rows.length} match(es) for "${arg}":`);
  for (const r of rows) {
    const name = r.company_name
      || `${r.firstName || ''} ${r.lastName || ''}`.trim()
      || '(no name)';
    console.log(`  ${name}  ·  ${r.phone}  ·  ${r.accountNumber || '(no acct)'}  ·  ${r.type}`);
  }
  await mongoose.disconnect();
  process.exit(0);
}
main().catch((err) => { console.error(err.message); process.exit(1); });
