// SokaSoko 360 fixture generator — round-robin groups + knockout
// bracket, per (gender, ageGroup) category. Only fires against
// tournaments where premiumBundle=FULL_360 AND premiumActivated=true.
//
// Public entry points:
//   generateFixturesFor(tournamentId, opts) → creates Match docs
//   computeStandingsFor(tournamentId, category?) → aggregates points

const mongoose = require('mongoose');
const Match = require('../Match/match.model');
const Tournament = require('./tournament.model');
const TournamentTeamRegistration = require(
  '../TournamentTeamRegistration/tournament_team_registration.model'
);

// Circle-method round-robin scheduler. Returns an array of rounds,
// each round is an array of [teamAId, teamBId] tuples. Odd counts
// get a BYE (null) per round.
function roundRobinRounds(teamIds) {
  const teams = teamIds.slice();
  if (teams.length % 2 === 1) teams.push(null); // bye
  const n = teams.length;
  const rounds = [];
  for (let r = 0; r < n - 1; r++) {
    const round = [];
    for (let i = 0; i < n / 2; i++) {
      const a = teams[i];
      const b = teams[n - 1 - i];
      if (a && b) round.push([a, b]);
    }
    // Rotate — keep first fixed, shift the rest
    teams.splice(1, 0, teams.pop());
    rounds.push(round);
  }
  return rounds;
}

// Split N teams evenly across G groups. Snake seeding when seeds
// provided (rank order); random otherwise. Returns {A: [...], B: [...]}.
function splitIntoGroups(teamIds, groupCount, seedOrder = 'RANDOM') {
  const teams = teamIds.slice();
  if (seedOrder === 'RANDOM') {
    for (let i = teams.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [teams[i], teams[j]] = [teams[j], teams[i]];
    }
  }
  const groups = {};
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (let g = 0; g < groupCount; g++) groups[letters[g]] = [];
  let i = 0;
  for (const t of teams) {
    groups[letters[i % groupCount]].push(t);
    i++;
  }
  return groups;
}

// Empty knockout bracket for `qualifierCount` teams — leaves both
// sides null until the group stage completes and populates them.
// Returns an array of Match-doc-shaped objects, one per bracket slot
// in seed order, with stage + bracketPosition + nextMatchId pre-set.
async function scaffoldKnockoutBracket({
  tournament, category, qualifierCount, defaultVenue, startDate,
}) {
  const roundsCount = Math.ceil(Math.log2(qualifierCount));
  const bracketSize = Math.pow(2, roundsCount);
  const stageForRound = (roundIdx, totalRounds) => {
    const fromEnd = totalRounds - roundIdx - 1;
    if (fromEnd === 0) return 'FINAL';
    if (fromEnd === 1) return 'SEMI';
    if (fromEnd === 2) return 'QUARTER';
    if (fromEnd === 3) return 'ROUND_16';
    if (fromEnd === 4) return 'ROUND_32';
    return 'ROUND_32';
  };
  // Build in reverse — final first, walk back to opening round —
  // so nextMatchId can be assigned as we create each parent.
  const createdByRound = [];
  let prevRoundIds = [];
  for (let r = roundsCount - 1; r >= 0; r--) {
    const stage = stageForRound(r, roundsCount);
    const matchesThisRound = Math.pow(2, r);
    const created = [];
    for (let pos = 0; pos < matchesThisRound; pos++) {
      const nextMatchId = prevRoundIds.length
        ? prevRoundIds[Math.floor(pos / 2)]
        : null;
      const m = await Match.create({
        homeTeam: null, awayTeam: null,
        homeScore: 0, awayScore: 0,
        status: 'SCHEDULED',
        scheduledDate: startDate,
        venue: defaultVenue || undefined,
        tournament: tournament._id,
        stage, bracketPosition: pos,
        nextMatchId,
        category,
      });
      created.push(m._id);
    }
    createdByRound.unshift(created);
    prevRoundIds = created;
  }
  return createdByRound;
}

// Main entry. opts:
//   { groupCount, teamsPerGroup, seedOrder, defaultVenue, startDate,
//     gapMinutes, category? } — if category is omitted, generates for
//   every category on the tournament.
async function generateFixturesFor(tournamentId, opts = {}) {
  const t = await Tournament.findById(tournamentId);
  if (!t) throw new Error('Tournament not found');
  if (t.premiumBundle !== 'FULL_360' || !t.premiumActivated) {
    const err = new Error(
      'Fixture generator requires an activated SokaSoko 360 tournament.'
    );
    err.status = 409;
    err.errorKey = 'tournament.err.360_not_activated';
    throw err;
  }
  const categories = opts.category
    ? [opts.category]
    : (t.categories || []).map((c) => ({ gender: c.gender, ageGroup: c.ageGroup }));
  if (!categories.length) throw new Error('Tournament has no categories');

  const gapMs = (opts.gapMinutes || 90) * 60 * 1000;
  const startDate = opts.startDate
    ? new Date(opts.startDate)
    : (t.startDate ? new Date(t.startDate) : new Date());
  const defaultVenue = opts.defaultVenue || t.venue || null;
  const groupCount = opts.groupCount || 2;
  const seedOrder = opts.seedOrder || 'RANDOM';

  const summary = { categories: [] };
  let slot = new Date(startDate.getTime());

  for (const cat of categories) {
    const regs = await TournamentTeamRegistration.find({
      tournament: t._id,
      status: 'APPROVED',
      'category.gender': cat.gender,
      'category.ageGroup': cat.ageGroup,
    }).select('team').lean();
    const teamIds = regs.map((r) => r.team.toString());
    if (teamIds.length < 2) {
      summary.categories.push({
        ...cat, skipped: 'not_enough_teams', teamCount: teamIds.length,
      });
      continue;
    }

    // Group stage
    const groups = splitIntoGroups(teamIds, groupCount, seedOrder);
    const groupMatches = [];
    for (const [groupName, ids] of Object.entries(groups)) {
      if (ids.length < 2) continue;
      const rounds = roundRobinRounds(ids);
      for (const round of rounds) {
        for (const [a, b] of round) {
          const m = await Match.create({
            homeTeam: a, awayTeam: b,
            homeScore: 0, awayScore: 0,
            status: 'SCHEDULED',
            scheduledDate: new Date(slot.getTime()),
            venue: defaultVenue || undefined,
            tournament: t._id,
            stage: 'GROUP',
            groupName,
            category: cat,
          });
          groupMatches.push(m._id);
          slot = new Date(slot.getTime() + gapMs);
        }
      }
    }

    // Knockout scaffold. Top-2-per-group qualifiers (standard).
    const groupNames = Object.keys(groups).filter((g) => groups[g].length >= 2);
    const qualifierCount = groupNames.length * 2;
    let knockoutRounds = [];
    if (qualifierCount >= 2) {
      knockoutRounds = await scaffoldKnockoutBracket({
        tournament: t,
        category: cat,
        qualifierCount,
        defaultVenue,
        startDate: new Date(slot.getTime() + gapMs * 2), // buffer after group
      });
    }

    summary.categories.push({
      ...cat,
      teamCount: teamIds.length,
      groups: Object.fromEntries(
        Object.entries(groups).map(([k, v]) => [k, v.length]),
      ),
      groupMatches: groupMatches.length,
      knockoutRounds: knockoutRounds.length,
      qualifierCount,
    });
  }

  // Flip tournament status to ONGOING (fixture publish = tournament
  // is officially running).
  t.status = 'ONGOING';
  await t.save();

  return summary;
}

// Standings for a category — aggregates completed GROUP matches into
// {team, played, won, drawn, lost, gf, ga, gd, points, group}.
async function computeStandingsFor(tournamentId, category = null) {
  const filter = {
    tournament: mongoose.Types.ObjectId(tournamentId),
    stage: 'GROUP',
    status: 'COMPLETED',
  };
  if (category) {
    filter['category.gender'] = category.gender;
    filter['category.ageGroup'] = category.ageGroup;
  }
  const matches = await Match.find(filter)
    .select('homeTeam awayTeam homeScore awayScore groupName category')
    .lean();

  const table = {}; // key: `${cat}|${group}|${teamId}` → row
  const bump = (teamId, groupName, cat, gf, ga) => {
    if (!teamId) return;
    const k = `${cat.gender}|${cat.ageGroup}|${groupName}|${teamId}`;
    if (!table[k]) {
      table[k] = {
        team: teamId.toString(),
        group: groupName,
        category: cat,
        played: 0, won: 0, drawn: 0, lost: 0,
        gf: 0, ga: 0, gd: 0, points: 0,
      };
    }
    const r = table[k];
    r.played += 1;
    r.gf += gf;
    r.ga += ga;
    r.gd = r.gf - r.ga;
    if (gf > ga) { r.won += 1; r.points += 3; }
    else if (gf === ga) { r.drawn += 1; r.points += 1; }
    else { r.lost += 1; }
  };
  for (const m of matches) {
    bump(m.homeTeam, m.groupName, m.category, m.homeScore, m.awayScore);
    bump(m.awayTeam, m.groupName, m.category, m.awayScore, m.homeScore);
  }
  const rows = Object.values(table);
  // Sort by group, then points desc → GD desc → GF desc.
  rows.sort((a, b) => {
    if (a.category.gender !== b.category.gender) {
      return a.category.gender.localeCompare(b.category.gender);
    }
    if (a.category.ageGroup !== b.category.ageGroup) {
      return a.category.ageGroup.localeCompare(b.category.ageGroup);
    }
    if (a.group !== b.group) return a.group.localeCompare(b.group);
    if (b.points !== a.points) return b.points - a.points;
    if (b.gd !== a.gd) return b.gd - a.gd;
    return b.gf - a.gf;
  });
  return rows;
}

module.exports = {
  generateFixturesFor,
  computeStandingsFor,
  roundRobinRounds,
  splitIntoGroups,
};
