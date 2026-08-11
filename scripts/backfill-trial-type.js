/**
 * One-off migration: stamps every existing Trial and TrialRegistration
 * with type/eventType = 'TRIAL' so that when the model gains a strict
 * discriminator, legacy rows continue to appear.
 *
 * Run:  MONGODB_URI="mongodb+srv://..." node scripts/backfill-trial-type.js
 *
 * Safe to run repeatedly — the update filter only touches docs where the
 * field is missing. Prints before/after counts.
 */
const mongoose = require('mongoose');

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set');
    process.exit(1);
  }
  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  const trials = db.collection('trials');
  const regs   = db.collection('trialregistrations');

  // The existing Trial schema already uses `type` for Open/Invite-Only.
  // Discriminator field is therefore `eventType` on both collections.
  const trialsMissing = await trials.countDocuments({ eventType: { $exists: false } });
  const regsMissing   = await regs.countDocuments({ eventType: { $exists: false } });
  console.log(`Trials missing eventType:         ${trialsMissing}`);
  console.log(`Registrations missing eventType:  ${regsMissing}`);

  if (trialsMissing > 0) {
    const res = await trials.updateMany(
      { eventType: { $exists: false } },
      { $set: { eventType: 'TRIAL' } }
    );
    console.log(`Stamped ${res.modifiedCount} trials with eventType='TRIAL'.`);
  }
  if (regsMissing > 0) {
    const res = await regs.updateMany(
      { eventType: { $exists: false } },
      { $set: { eventType: 'TRIAL' } }
    );
    console.log(`Stamped ${res.modifiedCount} registrations with eventType='TRIAL'.`);
  }

  // Verify no unstamped rows remain — this is the safety check the spec warned about.
  const trialsRemaining = await trials.countDocuments({ eventType: { $exists: false } });
  const regsRemaining   = await regs.countDocuments({ eventType: { $exists: false } });
  console.log(`\nPost-migration verification:`);
  console.log(`  Trials still missing type:         ${trialsRemaining}`);
  console.log(`  Registrations still missing type:  ${regsRemaining}`);
  if (trialsRemaining !== 0 || regsRemaining !== 0) {
    console.error('MIGRATION INCOMPLETE — do not deploy the model change until zero.');
    process.exit(1);
  }
  console.log('All rows stamped. Safe to deploy model changes.');

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error('backfill failed:', e.message);
  process.exit(1);
});
