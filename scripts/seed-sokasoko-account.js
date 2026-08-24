// Seed the SokaSoko official house account. Idempotent — safe to re-run.
//
// Usage:
//   node scripts/seed-sokasoko-account.js
//
// Requires MONGO_URL in .env (falls back to a local Mongo if unset).
//
// The house account is a regular User row with isHouseAccount=true.
// Its login credentials are irrelevant (an admin never logs in AS the
// house account — they log in as themselves with isAdmin=true, then
// reply-as-SokaSoko via the admin endpoint). Password is a random
// 32-byte hex string so no one can guess it.

require('dotenv').config();
const crypto = require('crypto');
const mongoose = require('mongoose');
const User = require('../src/User/user.model');

const MONGO_URL = process.env.MONGO_URL
  || process.env.MONGODB_URI
  || 'mongodb://localhost:27017/sokasoko';

async function main() {
  await mongoose.connect(MONGO_URL);
  const existing = await User.findOne({ isHouseAccount: true }).lean();
  if (existing) {
    console.log('✓ SokaSoko house account already exists');
    console.log('  id:', existing._id.toString());
    console.log('  accountNumber:', existing.accountNumber);
    console.log('  companyName:', existing.companyName);
    await mongoose.disconnect();
    process.exit(0);
  }

  const lockedPassword = crypto.randomBytes(32).toString('hex');
  const account = await User.create({
    firstName: 'SokaSoko',
    lastName: 'Msaidizi',
    companyName: 'SokaSoko',
    type: 'SPONSOR',
    sponsorType: 'Entity',
    entityName: 'SokaSoko',
    // Phone must be unique + 10 digits per the User schema. A synthetic
    // in-band-known number: no real user can register with this because
    // the seed grabs it first.
    phone: '0700000001',
    password: lockedPassword,
    isHouseAccount: true,
    // Verified by definition — no need to see the OTP flow.
    isVerified: true,
    // Bypass the beta testing gate so support is reachable during beta.
    betaTester: true,
  });

  console.log('✓ Created SokaSoko house account');
  console.log('  id:', account._id.toString());
  console.log('  accountNumber:', account.accountNumber);
  console.log('  companyName:', account.companyName);
  console.log('');
  console.log('Next: grant yourself admin access with:');
  console.log('  node scripts/grant-admin.js <your-phone>');

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('✗ Failed:', err.message);
  process.exit(1);
});
