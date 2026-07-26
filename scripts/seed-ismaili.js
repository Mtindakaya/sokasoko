/**
 * Create (or refresh) the Ismaili AI system account.
 *
 *   node scripts/seed-ismaili.js
 *
 * Idempotent — running multiple times leaves at most one Ismaili User row.
 * Prints the account _id to stdout so you can copy it into the
 * ISMAILI_USER_ID env var on Render.
 *
 * Reads MONGODB_URI from the same env the app uses.
 */

/* eslint-disable no-console */
const mongoose = require('mongoose');
const { getString } = require('@lykmapipo/env');
require('dotenv').config();

const User = require('../src/User/user.model');

async function main() {
  const uri = getString('MONGODB_URI') || getString('MONGO_URI');
  if (!uri) throw new Error('MONGODB_URI (or MONGO_URI) is not set');
  await mongoose.connect(uri);

  const existing = await User.findOne({ isSystemAgent: true, firstName: 'Ismaili' });
  if (existing) {
    console.log('Ismaili already exists:');
    console.log('  _id:', existing._id.toString());
    console.log('  accountNumber:', existing.accountNumber);
    await mongoose.disconnect();
    return;
  }

  const ismaili = await User.create({
    firstName: 'Ismaili',
    lastName: 'AI',
    // Regular type so chat/notification code paths treat it like a normal
    // user; the isSystemAgent flag is what keeps it out of pickers.
    type: 'SCOUT',
    accountNumber: 'TFH-AI-A000001',
    isSystemAgent: true,
    // Skip login: no email/phone; add a placeholder so unique constraints
    // (if any) don't fire.
    phone: '000000000',
    email: 'ismaili@sokasoko.local',
    short_bio:
      'Ismaili is the SokaSoko AI football knowledge assistant. Ask about tactics, training, refereeing, and scouting.',
    profileImage:
      'https://sokasoko.s3.us-west-2.amazonaws.com/avatar.png',
  });

  console.log('Ismaili created:');
  console.log('  _id:', ismaili._id.toString());
  console.log('  accountNumber:', ismaili.accountNumber);
  console.log('\nSet this on Render:');
  console.log(`  ISMAILI_USER_ID=${ismaili._id.toString()}`);

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('seed-ismaili failed:', err);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
