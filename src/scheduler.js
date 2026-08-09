const cron = require('node-cron');
const User = require('./User/user.model');
const { Subscription } = require('./Subscription/subscription.model');
const ScoutCv = require('./ScoutCv/scout_cv.model');
const Notification = require('./Notification/notification.model');
const { sendSms } = require('./Utils/utils');

// Promote lapsed subscriptions: ACTIVE → GRACE at endDate, then
// GRACE → EXPIRED once the 5-day grace window closes. When a subscription
// expires, effective tier drops back to STANDARD automatically because
// getEffectiveTier() no longer finds an ACTIVE-or-GRACE record.
const runSubscriptionLapseSweep = async () => {
  console.log('Running subscription lapse sweep...');
  const now = new Date();
  const activeToGrace = await Subscription.updateMany(
    { status: 'ACTIVE', endDate: { $lte: now } },
    { $set: { status: 'GRACE' } }
  );
  const graceToExpired = await Subscription.updateMany(
    { status: 'GRACE', gracePeriodEndsAt: { $lte: now } },
    { $set: { status: 'EXPIRED' } }
  );
  const inGrace = activeToGrace.modifiedCount || activeToGrace.nModified || 0;
  const expired = graceToExpired.modifiedCount || graceToExpired.nModified || 0;

  // Bell notification when someone drops into grace so they know to renew.
  if (inGrace > 0) {
    const newlyInGrace = await Subscription.find({
      status: 'GRACE',
      updatedAt: { $gte: new Date(now.getTime() - 60 * 60 * 1000) },
    }).select('user tier').lean();
    for (const s of newlyInGrace) {
      try {
        await Notification.create({
          userId: s.user,
          title: 'Subscription renewal reminder',
          body: `Your ${s.tier} subscription has ended. You have 5 days to renew before your account falls back to Standard.`,
          type: 'SUBSCRIPTION',
          metadata: { tier: s.tier, phase: 'GRACE' },
        });
      } catch (_) { /* best-effort */ }
    }
  }
  if (expired > 0) {
    const newlyExpired = await Subscription.find({
      status: 'EXPIRED',
      updatedAt: { $gte: new Date(now.getTime() - 60 * 60 * 1000) },
    }).select('user tier').lean();
    for (const s of newlyExpired) {
      try {
        await Notification.create({
          userId: s.user,
          title: 'Subscription expired',
          body: `Your ${s.tier} subscription has expired. Your account is now on the Standard tier — upgrade any time to restore full features.`,
          type: 'SUBSCRIPTION',
          metadata: { tier: s.tier, phase: 'EXPIRED' },
        });
      } catch (_) { /* best-effort */ }
    }
  }
  console.log(`Lapse sweep complete. Grace: ${inGrace}, Expired: ${expired}.`);
};

const runDailyCheck = async () => {
  console.log('Running daily subscription check...');
  const now = new Date();

  const users = await User.find({
    type: { $in: ['PLAYER', 'SCOUT'] },
    suspend: { $ne: true },
    freeTrialEndDate: { $ne: null },
  });

  for (const user of users) {
    const status = user.getAccessStatus();
    const phone = user.phone
      ? user.phone.replace(user.phone.charAt(0), '255')
      : null;

    if (!phone) continue;

    // 7 days before trial ends — send one notification
    if (status.status === 'FREE_TRIAL' && status.daysRemaining === 7) {
      if (!user.trialExpiredNotifiedAt) {
        await sendSms(
          `Habari ${user.firstName}, bado siku 7 kufika mwisho wa kipindi chako cha majaribio cha bure cha \nSokasoko. Jiandikishe sasa ili kuendelea kufurahia huduma zetu.`,
          phone
        );
        user.trialExpiredNotifiedAt = now;
        await user.save();
      }
    }

    // During grace period — send daily reminder
    if (status.status === 'GRACE_PERIOD') {
      await sendSms(
        `Habari ${user.firstName}, kipindi chako cha majaribio cha bure cha Sokasoko kimekwisha. Una siku \n${status.daysRemaining} za ziada. Jiandikishe sasa ili usipoteze ufikiaji.`,
        phone
      );
      user.gracePeriodNotifiedAt = now;
      await user.save();
    }
  }

  console.log(`Daily check complete. Processed ${users.length} users.`);
};

const runMonthlyProgressReports = async () => {
  console.log('Running monthly player progress reports...');

  // Find all players with an active subscription
  const activeSubs = await Subscription.find({
    userType: 'PLAYER',
    status: 'ACTIVE',
    endDate: { $gt: new Date() },
  }).lean();

  const playerIds = activeSubs.map((s) => s.user);
  const players = await User.find({ _id: { $in: playerIds }, type: 'PLAYER' }).lean();

  for (const player of players) {
    try {
      const scoutCvCount = await ScoutCv.countDocuments({ player: player._id });
      const verifiedCount = await ScoutCv.countDocuments({
        player: player._id,
        verificationStatus: 'VERIFIED',
      });

      const profileFields = ['firstName', 'lastName', 'position', 'region', 'nationality', 'dob', 'gender', 'height', 'weight', 'foot'];
      const filledFields = profileFields.filter((f) => player[f] && player[f].toString().trim() !== '');
      const completeness = Math.round((filledFields.length / profileFields.length) * 100);

      let bodyLines = [`Hi ${player.firstName}, here is your monthly SokaSoko progress summary:`];
      bodyLines.push(`• Profile completeness: ${completeness}%`);
      bodyLines.push(`• Times identified by scouts: ${scoutCvCount}`);
      if (verifiedCount > 0) bodyLines.push(`• Verified scout identifications: ${verifiedCount}`);
      if (completeness < 80) bodyLines.push('• Tip: Complete your profile to attract more scouts!');
      if (scoutCvCount === 0) bodyLines.push('• No scout activity yet — keep updating your profile and videos.');

      await Notification.create({
        userId: player._id,
        title: 'Your Monthly Progress Report',
        body: bodyLines.join('\n'),
        type: 'PROGRESS_REPORT',
        metadata: { scoutCvCount, verifiedCount, profileCompleteness: completeness },
      });
    } catch (e) {
      console.error(`Failed progress report for player ${player._id}:`, e.message);
    }
  }

  console.log(`Monthly progress reports sent to ${players.length} subscribed players.`);
};

// Run every day at 8:00 AM
cron.schedule('0 8 * * *', runDailyCheck);

// Run on the 1st of every month at 7:00 AM
cron.schedule('0 7 1 * *', runMonthlyProgressReports);

// Subscription lapse sweep — every 6 hours so grace-period transitions
// happen close to real time without hammering the DB.
cron.schedule('0 */6 * * *', runSubscriptionLapseSweep);

console.log('Scheduler started — daily 8:00, monthly-reports 1st 7:00, lapse-sweep every 6h');

module.exports = { runDailyCheck, runMonthlyProgressReports, runSubscriptionLapseSweep };
