/**
 * Create (or refresh) the SokaSoko Official house ad-venue account.
 *
 *   node scripts/seed-sokasoko-official.js
 *
 * Idempotent — running multiple times leaves at most one SokaSoko
 * Official User row. Prints the account _id so you can set it as
 * SOKASOKO_OFFICIAL_USER_ID on Render; the CMS Advert form reads
 * that env to pin house ads to this user.
 *
 * Reads MONGODB_URI from the same env the app uses.
 */

/* eslint-disable no-console */
const crypto = require('crypto');
const mongoose = require('mongoose');
const { getString } = require('@lykmapipo/env');
require('dotenv').config();

const User = require('../src/User/user.model');

async function main() {
  const uri = getString('MONGODB_URI') || getString('MONGO_URI');
  if (!uri) throw new Error('MONGODB_URI (or MONGO_URI) is not set');
  await mongoose.connect(uri);

  const existing = await User.findOne({
    isSystemAgent: true,
    firstName: 'SokaSoko',
    lastName: 'Official',
  });
  if (existing) {
    console.log('SokaSoko Official already exists:');
    console.log('  _id:', existing._id.toString());
    console.log('  accountNumber:', existing.accountNumber);
    await mongoose.disconnect();
    return;
  }

  const official = await User.create({
    firstName: 'SokaSoko',
    lastName: 'Official',
    // VENDOR so the advert sampler + profile tooling treat it like a
    // normal advertiser. The isSystemAgent flag keeps it out of user
    // pickers and prevents it from being surfaced as a regular vendor
    // in search.
    type: 'VENDOR',
    accountNumber: 'TFH-V-OFFICIAL',
    isSystemAgent: true,
    phone: '000000001',
    email: 'official@sokasoko.local',
    company_name: 'SokaSoko Official',
    short_bio:
      'Official SokaSoko placements — platform announcements, '
      + 'featured events, and partner highlights.',
    profileImage:
      'https://sokasoko.s3.us-west-2.amazonaws.com/avatar.png',
    // Account should never be logged into — random password keeps it
    // locked out even if someone finds the email.
    password: crypto.randomBytes(32).toString('hex'),
  });

  console.log('SokaSoko Official created:');
  console.log('  _id:', official._id.toString());
  console.log('  accountNumber:', official.accountNumber);
  console.log('\nSet this on Render + CMS env:');
  console.log(`  SOKASOKO_OFFICIAL_USER_ID=${official._id.toString()}`);

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('seed-sokasoko-official failed:', err);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
