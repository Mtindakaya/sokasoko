// Debug helper — dumps the current SokaSoko house-account row so we
// can see what fields are set.
require('dotenv').config();
const mongoose = require('mongoose');
require('../src/Academy/academy.model');
const User = require('../src/User/user.model');

const MONGO_URL = process.env.MONGO_URL
  || process.env.MONGODB_URI
  || 'mongodb://localhost:27017/sokasoko';

async function main() {
  await mongoose.connect(MONGO_URL);
  const rows = await User.find({ isHouseAccount: true });
  console.log(`Found ${rows.length} house-account row(s):`);
  for (const r of rows) {
    console.log('  id:', r._id.toString());
    console.log('  firstName:', r.firstName);
    console.log('  lastName:', r.lastName);
    console.log('  company_name:', r.company_name);
    console.log('  entity_name:', r.entity_name);
    console.log('  accountNumber:', r.accountNumber);
    console.log('  type:', r.type);
    console.log('  sponsor_type:', r.sponsor_type);
    console.log('  phone:', r.phone);
    console.log('  betaTester:', r.betaTester);
    console.log('  isHouseAccount:', r.isHouseAccount);
    console.log('  createdAt:', r.createdAt);
    console.log('  ---');
  }
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('✗ Failed:', err.message);
  process.exit(1);
});
