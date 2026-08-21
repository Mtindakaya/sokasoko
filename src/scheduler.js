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
          title: 'Kumbusho la kurejesha uandikishaji',
          body: `Uandikishaji wako wa ${s.tier} umekwisha. Una siku 5 kurejesha kabla akaunti yako haijashuka kwenda Standard.`,
          titleKey: 'notif.sub.renewal_reminder.title',
          bodyKey: 'notif.sub.renewal_reminder.body',
          params: { tier: s.tier },
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
          title: 'Uandikishaji umekwisha',
          body: `Uandikishaji wako wa ${s.tier} umekwisha muda. Akaunti yako sasa iko kwenye Standard — boresha wakati wowote kurudisha vipengele vyote.`,
          titleKey: 'notif.sub.expired.title',
          bodyKey: 'notif.sub.expired.body',
          params: { tier: s.tier },
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

      // Progress report body is composed of conditional bullet lines. We
      // send a single 'notif.progress.summary' bodyKey with all the params
      // AND still write the raw Kiswahili body so legacy clients render
      // correctly. The client rebuilds the localized bullet list on read
      // using the params (see L10n.tNotifBody / progress-specific helper).
      let bodyLines = [`Habari ${player.firstName}, hii ni muhtasari wako wa mwezi wa SokaSoko:`];
      bodyLines.push(`• Ukamilifu wa wasifu: ${completeness}%`);
      bodyLines.push(`• Umeonekana na skauti mara: ${scoutCvCount}`);
      if (verifiedCount > 0) bodyLines.push(`• Utambulisho uliohakikiwa na skauti: ${verifiedCount}`);
      if (completeness < 80) bodyLines.push('• Ushauri: Kamilisha wasifu wako ili kuvutia skauti zaidi!');
      if (scoutCvCount === 0) bodyLines.push('• Hakuna shughuli ya skauti bado — endelea kusasisha wasifu wako na video.');

      await Notification.create({
        userId: player._id,
        title: 'Ripoti Yako ya Mwezi',
        body: bodyLines.join('\n'),
        titleKey: 'notif.progress.title',
        // No single bodyKey — the client stitches bullets from params.
        bodyKey: 'notif.progress.summary',
        params: {
          name: player.firstName,
          completeness,
          scoutViews: scoutCvCount,
          verifiedCount,
          showTipComplete: completeness < 80,
          showTipNoScout: scoutCvCount === 0,
        },
        type: 'PROGRESS_REPORT',
        metadata: { scoutCvCount, verifiedCount, profileCompleteness: completeness },
      });
    } catch (e) {
      console.error(`Failed progress report for player ${player._id}:`, e.message);
    }
  }

  console.log(`Monthly progress reports sent to ${players.length} subscribed players.`);
};

// Runs daily. When an org has more ACTIVE staff than its current tier's
// staff-seat cap, a warning notification fires the first time, and after
// STAFF_OVERQUOTA_GRACE_DAYS days over quota all their staff links are
// disabled until the owner trims down.
const STAFF_OVERQUOTA_GRACE_DAYS = 5;
const runStaffQuotaSweep = async () => {
  console.log('Running org-staff quota sweep...');
  try {
    const OrgStaffLink = require('./OrgStaff/org_staff.model');
    const { FEATURE_CAPS, Subscription } = require('./Subscription/subscription.model');
    const orgIds = await OrgStaffLink.distinct('org', { status: 'ACTIVE' });
    for (const orgId of orgIds) {
      const org = await User.findById(orgId).select('type staffOverQuotaSince').lean();
      if (!org) continue;
      const orgType = org.type;
      let cap;
      if (orgType === 'SCHOOL') {
        cap = FEATURE_CAPS.SCHOOL?.FREE?.staffSeats || 0;
      } else {
        const tier = await Subscription.getEffectiveTier(orgId, orgType);
        cap = (FEATURE_CAPS[orgType]?.[tier] || {}).staffSeats || 0;
      }
      const activeCount = await OrgStaffLink.countDocuments({
        org: orgId, status: 'ACTIVE',
      });
      if (activeCount <= cap) {
        if (org.staffOverQuotaSince) {
          await User.updateOne({ _id: orgId }, { $unset: { staffOverQuotaSince: 1 } });
        }
        continue;
      }
      // Over quota. Stamp the start date on the first hit, then disable
      // all staff once the grace window closes.
      if (!org.staffOverQuotaSince) {
        await User.updateOne({ _id: orgId },
          { $set: { staffOverQuotaSince: new Date() } });
        try {
          await Notification.create({
            userId: orgId,
            title: 'Umezidi kikomo cha wafanyakazi',
            body: `Una wafanyakazi ${activeCount} lakini kifurushi chako kinaruhusu ${cap}. Ondoa ${activeCount - cap} ndani ya siku ${STAFF_OVERQUOTA_GRACE_DAYS} au wote watazuiliwa.`,
            titleKey: 'notif.staff.over_quota.title',
            bodyKey: 'notif.staff.over_quota.body',
            params: {
              active: activeCount,
              cap,
              excess: activeCount - cap,
              days: STAFF_OVERQUOTA_GRACE_DAYS,
            },
            type: 'SYSTEM',
            metadata: { current: activeCount, cap },
          });
        } catch (_) {}
      } else {
        const graceEnd = new Date(new Date(org.staffOverQuotaSince).getTime()
          + STAFF_OVERQUOTA_GRACE_DAYS * 24 * 60 * 60 * 1000);
        if (new Date() > graceEnd) {
          // Disable ALL staff for this org.
          const links = await OrgStaffLink.find({ org: orgId, status: 'ACTIVE' });
          for (const link of links) {
            link.status = 'DISABLED';
            link.disabledAt = new Date();
            link.disabledReason = 'Org exceeded staff quota for 5+ days';
            await link.save();
            try {
              await Notification.create({
                userId: link.staff,
                title: 'Ushirikiano wa mfanyakazi umezuiliwa',
                body: 'Taasisi imezidi kikomo cha wafanyakazi. Wasiliana nao.',
                titleKey: 'notif.staff.link_disabled.title',
                bodyKey: 'notif.staff.link_disabled.body',
                params: {},
                type: 'SYSTEM',
                metadata: { linkId: link._id.toString() },
              });
            } catch (_) {}
          }
          await User.updateOne({ _id: orgId },
            { $unset: { staffOverQuotaSince: 1 } });
        }
      }
    }
  } catch (err) {
    console.log('[scheduler] staff quota sweep failed:', err.message);
  }
};

// Run every day at 8:00 AM
cron.schedule('0 8 * * *', runDailyCheck);
cron.schedule('30 8 * * *', runStaffQuotaSweep);

// Run on the 1st of every month at 7:00 AM
cron.schedule('0 7 1 * *', runMonthlyProgressReports);

// Subscription lapse sweep — every 6 hours so grace-period transitions
// happen close to real time without hammering the DB.
cron.schedule('0 */6 * * *', runSubscriptionLapseSweep);

console.log('Scheduler started — daily 8:00, monthly-reports 1st 7:00, lapse-sweep every 6h');

module.exports = {
  runDailyCheck,
  runMonthlyProgressReports,
  runSubscriptionLapseSweep,
  runStaffQuotaSweep,
};
