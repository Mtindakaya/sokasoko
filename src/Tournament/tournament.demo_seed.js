// SokaSoko 360 demo seeder — spins up a fully-populated tournament
// in one call so sales demos + QA don't need to run the real
// registration → fixtures → results cycle.
//
// Reuses existing ACADEMY / CLUB accounts as teams when available;
// falls back to creating throw-away demo teams tagged with
// `isDemoAccount: true` so a cleanup script can nuke them later.

const mongoose = require('mongoose');
const User = require('../User/user.model');
const Tournament = require('./tournament.model');
const TournamentTeamRegistration = require(
  '../TournamentTeamRegistration/tournament_team_registration.model'
);
const Match = require('../Match/match.model');
const { generateFixturesFor } = require('./tournament.fixtures');

// ── Team sourcing ────────────────────────────────────────────────────

async function _pickOrCreateTeams({ count, region, district, organizer }) {
  // Try existing ACADEMY/CLUB accounts first — realistic demo data.
  const query = { type: { $in: ['ACADEMY', 'CLUB'] } };
  if (region) query.region = region;
  if (district) query.district = district;
  const existing = await User.find(query)
    .select('_id academyName firstName lastName')
    .limit(count)
    .lean();
  const picked = existing.slice(0, count).map((u) => u._id);
  const shortfall = count - picked.length;
  if (shortfall <= 0) return picked;

  // Not enough real teams — synthesise throwaway demo accounts.
  const created = [];
  for (let i = 0; i < shortfall; i++) {
    const nick = `Demo Team ${Date.now().toString().slice(-5)}-${i + 1}`;
    const acct = `TFH-DEMO-${Math.floor(Math.random() * 900000) + 100000}`;
    try {
      const u = await User.create({
        type: 'ACADEMY',
        academyName: nick,
        academy_name: nick,
        firstName: nick,
        lastName: '',
        phone: `+2557000000${(Math.random() * 10000).toFixed(0).padStart(4, '0')}`,
        password: '__DEMO__',
        accountNumber: acct,
        region: region || 'Dar es Salaam',
        district: district || 'Ilala',
        isDemoAccount: true,
        createdBy: organizer,
      });
      created.push(u._id);
    } catch (_) { /* skip if any unique clash */ }
  }
  return picked.concat(created);
}

// ── Category-registration seed ───────────────────────────────────────

async function _autoApproveRegistrations({
  tournamentId, teams, categories, reviewer,
}) {
  const created = [];
  for (const cat of categories) {
    for (const team of teams) {
      try {
        const doc = await TournamentTeamRegistration.create({
          tournament: tournamentId,
          team,
          category: { gender: cat.gender, ageGroup: cat.ageGroup },
          submittedBy: reviewer || team,
          status: 'APPROVED',
          reviewedBy: reviewer || null,
          reviewedAt: new Date(),
        });
        created.push(doc._id);
      } catch (_) { /* dup key — team already registered */ }
    }
  }
  return created;
}

// ── Random-result completion ─────────────────────────────────────────

async function _completeSomeMatches({ tournamentId, ratio = 0.7 }) {
  const groupMatches = await Match.find({
    tournament: tournamentId,
    stage: 'GROUP',
    status: 'SCHEDULED',
  });
  const target = Math.floor(groupMatches.length * ratio);
  let completed = 0;
  for (const m of groupMatches.slice(0, target)) {
    const home = Math.floor(Math.random() * 5); // 0..4
    const away = Math.floor(Math.random() * 5);
    m.homeScore = home;
    m.awayScore = away;
    m.status = 'COMPLETED';
    m.homeConfirmed = true;
    m.awayConfirmed = true;
    m._justCompleted = true; // wake existing hooks
    await m.save();
    completed++;
  }
  return { totalGroup: groupMatches.length, completed };
}

// ── Public entry point ───────────────────────────────────────────────

async function seedDemoTournament(opts = {}) {
  const {
    name = `Demo Cup ${new Date().toISOString().slice(0, 10)}`,
    organizer, // required — the admin/organizer User._id
    region = 'Dar es Salaam',
    district = 'Ilala',
    teamCount = 8,
    categories = [
      { gender: 'MALE', ageGroup: 'U14' },
      { gender: 'FEMALE', ageGroup: 'U14' },
    ],
    completionRatio = 0.7,
    groupCount = 2,
  } = opts;
  if (!organizer) throw new Error('organizer is required');

  // 1. Tournament with FULL_360 + activated + published.
  const startDate = new Date();
  const endDate = new Date(startDate.getTime() + 30 * 24 * 60 * 60 * 1000);
  const t = await Tournament.create({
    name,
    type: 'GROUP_THEN_KNOCKOUT',
    organizer,
    startDate,
    endDate,
    region,
    district,
    maxTeams: teamCount,
    categories,
    description: 'Auto-generated demo tournament — safe to delete.',
    firstPrize: 'Championship trophy',
    runnerUpPrize: 'Runner-up medal',
    tier: 'SOKASOKO',
    isPublished: true,
    publishedAt: new Date(),
    premiumBundle: 'FULL_360',
    premiumActivated: true,
    premiumActivatedAt: new Date(),
    premiumFeeReceipt: 'DEMO-SEED',
    isDemoTournament: true,
  });

  // 2. Team pool.
  const teams = await _pickOrCreateTeams({
    count: teamCount, region, district, organizer,
  });

  // 3. Approved registrations for every category.
  const regs = await _autoApproveRegistrations({
    tournamentId: t._id, teams, categories, reviewer: organizer,
  });

  // 4. Populate Tournament.teams for the base flow's benefit.
  t.teams = teams;
  await t.save();

  // 5. Generate fixtures.
  const fixtureSummary = await generateFixturesFor(t._id, {
    groupCount, seedOrder: 'RANDOM', gapMinutes: 90,
    startDate: new Date(startDate.getTime() + 24 * 60 * 60 * 1000),
  });

  // 6. Auto-complete ~ratio of group matches with random scores.
  const completed = await _completeSomeMatches({
    tournamentId: t._id, ratio: completionRatio,
  });

  return {
    tournament: {
      _id: t._id,
      name: t.name,
      premiumBundle: t.premiumBundle,
      premiumActivated: t.premiumActivated,
    },
    teams: teams.length,
    registrations: regs.length,
    fixtures: fixtureSummary,
    matches: completed,
    hubUrl: `/tournaments/${t._id}`,
  };
}

// ── Cleanup helper ───────────────────────────────────────────────────

async function cleanupDemoTournaments() {
  const demoTournaments = await Tournament.find({ isDemoTournament: true })
    .select('_id').lean();
  const ids = demoTournaments.map((t) => t._id);
  if (ids.length === 0) return { tournaments: 0, matches: 0, registrations: 0, users: 0 };
  const [mDel, rDel, tDel, uDel] = await Promise.all([
    Match.deleteMany({ tournament: { $in: ids } }),
    TournamentTeamRegistration.deleteMany({ tournament: { $in: ids } }),
    Tournament.deleteMany({ _id: { $in: ids } }),
    User.deleteMany({ isDemoAccount: true }),
  ]);
  return {
    tournaments: tDel.deletedCount || 0,
    matches: mDel.deletedCount || 0,
    registrations: rDel.deletedCount || 0,
    users: uDel.deletedCount || 0,
  };
}

module.exports = { seedDemoTournament, cleanupDemoTournaments };
