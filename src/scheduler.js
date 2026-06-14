const cron = require('node-cron');
const User = require('./User/user.model');
const { Subscription } = require('./Subscription/subscription.model');
const ScoutCv = require('./ScoutCv/scout_cv.model');
const Notification = require('./Notification/notification.model');
const { sendSms } = require('./Utils/utils');

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

console.log('Scheduler started — daily at 8:00 AM, monthly progress reports on 1st at 7:00 AM');

module.exports = { runDailyCheck, runMonthlyProgressReports };
