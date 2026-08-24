// Grant / revoke SokaSoko support-agent (isAdmin=true) on a User row.
//
// Usage:
//   node scripts/grant-admin.js <phone-or-accountNumber>          # grant
//   node scripts/grant-admin.js <phone-or-accountNumber> --revoke  # revoke
//
// Admins can:
//   - See the SokaSoko Support Inbox screen in the mobile app
//   - Reply as SokaSoko to any user's support DM
//   - Mark support conversations resolved
// They cannot log in AS the SokaSoko house account — replies always
// come from their own logged-in session, but the sender on the wire
// is stamped as the house account so users only ever see "SokaSoko".

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../src/User/user.model');

const MONGO_URL = process.env.MONGO_URL
  || process.env.MONGODB_URI
  || 'mongodb://localhost:27017/sokasoko';

async function main() {
  const arg = process.argv[2];
  const revoke = process.argv.includes('--revoke');
  if (!arg) {
    console.error('Usage: node scripts/grant-admin.js <phone-or-accountNumber> [--revoke]');
    process.exit(1);
  }

  await mongoose.connect(MONGO_URL);
  const user = await User.findOne({
    $or: [{ phone: arg }, { accountNumber: arg }],
  });
  if (!user) {
    console.error('✗ No user matches phone / accountNumber:', arg);
    await mongoose.disconnect();
    process.exit(1);
  }
  const wasAdmin = !!user.isAdmin;
  user.isAdmin = !revoke;
  await user.save();

  const name = user.companyName
    || `${user.firstName || ''} ${user.lastName || ''}`.trim();
  console.log(revoke
    ? `✓ Revoked admin from ${name} (${user.accountNumber})`
    : `✓ Granted admin to ${name} (${user.accountNumber})`);
  if (wasAdmin === !revoke) {
    console.log('  (no change — already in the target state)');
  }

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('✗ Failed:', err.message);
  process.exit(1);
});
