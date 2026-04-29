const cron = require('node-cron');
const User = require('./User/user.model');
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
          `Habari ${user.firstName}, bado siku 7 kufika mwisho wa kipindi chako cha majaribio cha bure cha 
Sokasoko. Jiandikishe sasa ili kuendelea kufurahia huduma zetu.`,
          phone
        );
        user.trialExpiredNotifiedAt = now;
        await user.save();
      }
    }

    // During grace period — send daily reminder
    if (status.status === 'GRACE_PERIOD') {
      await sendSms(
        `Habari ${user.firstName}, kipindi chako cha majaribio cha bure cha Sokasoko kimekwisha. Una siku 
${status.daysRemaining} za ziada. Jiandikishe sasa ili usipoteze ufikiaji.`,
        phone
      );
      user.gracePeriodNotifiedAt = now;
      await user.save();
    }
  }

  console.log(`Daily check complete. Processed ${users.length} users.`);
};

// Run every day at 8:00 AM
cron.schedule('0 8 * * *', runDailyCheck);

console.log('Scheduler started — running daily at 8:00 AM');

module.exports = { runDailyCheck };
