const Match = require('./match.model');

// Match-time conflict windows (minutes on each side of scheduledDate).
// Refs/scouts/venues: symmetric ±2h — covers a 90-min game + warmup +
// travel/handover between assignments.
// Teams: asymmetric -2h/+3h per product decision — a team that just
// finished a match needs longer recovery than the pre-game buffer.
const REF_SCOUT_WINDOW_MIN = 120;
const VENUE_WINDOW_MIN     = 120;
const TEAM_WINDOW_BEHIND   = 120;
const TEAM_WINDOW_AHEAD    = 180;

// Statuses that still "occupy" a slot. COMPLETED and CANCELLED release
// the slot; POSTPONED / DECLINED are dead too. Everything else (default
// SCHEDULED, plus ONGOING and any future workflow states) counts as
// active.
const INACTIVE_STATUSES = ['COMPLETED', 'CANCELLED', 'POSTPONED', 'DECLINED'];

const MS_PER_MIN = 60 * 1000;

const windowFor = (proposedIso, behindMin, aheadMin) => {
  const proposed = new Date(proposedIso);
  return {
    from: new Date(proposed.getTime() - behindMin * MS_PER_MIN),
    to: new Date(proposed.getTime() + aheadMin * MS_PER_MIN),
  };
};

// Returns a Set of user-IDs (as strings) from `candidateIds` that already
// have another active match within ±REF_SCOUT_WINDOW_MIN of proposedIso.
// `excludeMatchId` skips the given match — needed when rescheduling.
async function busyUserIds(
  candidateIds,
  proposedIso,
  { excludeMatchId = null } = {},
) {
  if (!candidateIds || !candidateIds.length) return new Set();
  const { from, to } = windowFor(
    proposedIso,
    REF_SCOUT_WINDOW_MIN,
    REF_SCOUT_WINDOW_MIN,
  );
  const q = {
    scheduledDate: { $gte: from, $lte: to },
    status: { $nin: INACTIVE_STATUSES },
    $or: [
      { referee: { $in: candidateIds } },
      { assistantReferee1: { $in: candidateIds } },
      { assistantReferee2: { $in: candidateIds } },
      { scout: { $in: candidateIds } },
      { 'scouts.scout': { $in: candidateIds } },
    ],
  };
  if (excludeMatchId) q._id = { $ne: excludeMatchId };
  const rows = await Match.find(q)
    .select('referee assistantReferee1 assistantReferee2 scout scouts')
    .lean();
  const busy = new Set();
  const idStr = (v) => (v == null ? null : String(v));
  const wanted = new Set(candidateIds.map((c) => String(c)));
  for (const r of rows) {
    [r.referee, r.assistantReferee1, r.assistantReferee2, r.scout]
      .map(idStr)
      .filter((id) => id && wanted.has(id))
      .forEach((id) => busy.add(id));
    (r.scouts || [])
      .map((s) => idStr(s?.scout))
      .filter((id) => id && wanted.has(id))
      .forEach((id) => busy.add(id));
  }
  return busy;
}

// True if the venue is already booked by another active match within
// ±VENUE_WINDOW_MIN.
async function venueBusy(
  venueId,
  proposedIso,
  { excludeMatchId = null } = {},
) {
  if (!venueId) return false;
  const { from, to } = windowFor(
    proposedIso,
    VENUE_WINDOW_MIN,
    VENUE_WINDOW_MIN,
  );
  const q = {
    venue: venueId,
    scheduledDate: { $gte: from, $lte: to },
    status: { $nin: INACTIVE_STATUSES },
  };
  if (excludeMatchId) q._id = { $ne: excludeMatchId };
  const hit = await Match.exists(q);
  return !!hit;
}

// Returns a Set of team-IDs (as strings) from `teamIds` that have another
// active match within the asymmetric team window (-TEAM_WINDOW_BEHIND to
// +TEAM_WINDOW_AHEAD) around proposedIso.
async function busyTeamIds(
  teamIds,
  proposedIso,
  { excludeMatchId = null } = {},
) {
  if (!teamIds || !teamIds.length) return new Set();
  const { from, to } = windowFor(
    proposedIso,
    TEAM_WINDOW_BEHIND,
    TEAM_WINDOW_AHEAD,
  );
  const q = {
    scheduledDate: { $gte: from, $lte: to },
    status: { $nin: INACTIVE_STATUSES },
    $or: [
      { homeTeam: { $in: teamIds } },
      { awayTeam: { $in: teamIds } },
    ],
  };
  if (excludeMatchId) q._id = { $ne: excludeMatchId };
  const rows = await Match.find(q).select('homeTeam awayTeam').lean();
  const busy = new Set();
  const wanted = new Set(teamIds.map((t) => String(t)));
  for (const r of rows) {
    [r.homeTeam, r.awayTeam]
      .map((v) => (v == null ? null : String(v)))
      .filter((id) => id && wanted.has(id))
      .forEach((id) => busy.add(id));
  }
  return busy;
}

module.exports = {
  busyUserIds,
  venueBusy,
  busyTeamIds,
  REF_SCOUT_WINDOW_MIN,
  VENUE_WINDOW_MIN,
  TEAM_WINDOW_BEHIND,
  TEAM_WINDOW_AHEAD,
};
