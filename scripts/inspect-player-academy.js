/**
 * Inspects a player's academy state end-to-end so we can tell whether
 * "Free Agent" on the vCard is:
 *   - a stale User.academy pointing at a deleted enrollment,
 *   - a populate depth issue (Academy.addedBy still an ObjectId),
 *   - or simply the invite is still PENDING.
 *
 * Run:  MONGODB_URI="..." node scripts/inspect-player-academy.js A000161
 */
require('dotenv').config();
const mongoose = require('mongoose');

async function main() {
  const acct = process.argv[2];
  if (!acct) {
    console.error('Usage: node scripts/inspect-player-academy.js <ACCOUNT_NO>');
    process.exit(1);
  }
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set');
    process.exit(1);
  }
  await mongoose.connect(uri);

  const User = require('../src/User/user.model');
  const Academy = require('../src/Academy/academy.model');

  const player = await User.findOne({ accountNumber: acct }).lean();
  if (!player) {
    console.error(`No user with accountNumber=${acct}`);
    await mongoose.disconnect();
    process.exit(1);
  }
  console.log(`Player: ${player.firstName} ${player.lastName} · ${player.type} · _id=${player._id}`);
  console.log(`User.academy raw: ${player.academy}`);

  // 1. What .populate('academy') actually returns (matches production route).
  const populated = await User.findById(player._id).populate('academy').lean();
  console.log('\n[1] .populate("academy") shape:');
  console.log('    typeof populated.academy =', typeof populated.academy);
  if (populated.academy && typeof populated.academy === 'object') {
    console.log('    academy._id           =', populated.academy._id);
    console.log('    academy.verificationStatus =', populated.academy.verificationStatus);
    console.log('    academy.level         =', populated.academy.level);
    console.log('    academy.addedBy (raw) =', populated.academy.addedBy, `(${typeof populated.academy.addedBy})`);
  }

  // 2. Same query with nested populate on addedBy — this is the fix
  //    candidate.
  const deep = await User.findById(player._id)
    .populate({
      path: 'academy',
      populate: {
        path: 'addedBy',
        select: 'academy_name company_name entity_name firstName lastName type profileImage',
      },
    }).lean();
  console.log('\n[2] Nested populate shape:');
  if (deep.academy) {
    console.log('    academy._id           =', deep.academy._id);
    console.log('    academy.addedBy type  =', typeof deep.academy.addedBy);
    if (deep.academy.addedBy && typeof deep.academy.addedBy === 'object') {
      console.log('    addedBy.type          =', deep.academy.addedBy.type);
      console.log('    addedBy.academy_name  =', deep.academy.addedBy.academy_name);
      console.log('    addedBy.company_name  =', deep.academy.addedBy.company_name);
      console.log('    addedBy.entity_name   =', deep.academy.addedBy.entity_name);
      console.log('    addedBy.firstName     =', deep.academy.addedBy.firstName);
    }
  } else {
    console.log('    academy = null (User.academy field is empty)');
  }

  // 3. All Academy rows for this player (any status).
  const allEnrollments = await Academy.find({ player: player._id }).lean();
  console.log(`\n[3] All Academy rows for this player: ${allEnrollments.length}`);
  for (const r of allEnrollments) {
    console.log('   ', {
      _id: r._id.toString(),
      status: r.verificationStatus,
      level: r.level,
      addedBy: r.addedBy?.toString(),
      verifiedAt: r.verifiedAt,
      createdAt: r.createdAt,
    });
  }

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error('inspect failed:', e.message);
  process.exit(1);
});
