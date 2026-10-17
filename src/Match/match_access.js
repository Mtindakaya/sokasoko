// Match action authorization. A user can act on a match's team when
// they ARE the team account OR they hold an ACTIVE OrgStaffLink to
// the team with a role that grants score authority.
//
// Kept as a separate module so gate checks in match.http.router.js
// stay one-liners and the roles list has a single source of truth.

const OrgStaffLink = require('../OrgStaff/org_staff.model');

// Roles that grant match/score authority. OTHER and custom-titled
// roles are chat-only, no elevated privileges. Mirrors the notified
// set in match_notifications.js so "who can act" and "who is told"
// stay consistent.
const SCORE_ACCESS_ROLES = ['OWNER', 'MANAGER', 'COACH', 'SECRETARY'];

/**
 * True when userId is authorized to manage teamId's match actions
 * (schedule, enter/edit result, confirm score, cancel, reschedule,
 * confirm/decline schedule).
 *
 * Two paths:
 *   1. userId === teamId → the team account itself, always allowed.
 *   2. ACTIVE OrgStaffLink where staff=userId, org=teamId, and role
 *      ∈ SCORE_ACCESS_ROLES.
 */
async function canManageTeam(userId, teamId) {
  if (!userId || !teamId) return false;
  if (String(userId) === String(teamId)) return true;
  const link = await OrgStaffLink.findOne({
    staff: userId,
    org: teamId,
    status: 'ACTIVE',
    role: { $in: SCORE_ACCESS_ROLES },
  }).select('_id role').lean();
  return !!link;
}

/**
 * True when userId is the sub-team captain / assistant captain of the
 * given match side on an intra-school fixture. Falls through silently
 * (returns false) for non-intra matches so callers can OR with the
 * regular canManageTeam path.
 */
async function canActOnIntraMatchSide(userId, match, side) {
  if (!userId || !match || !match.isIntraSchool) return false;
  const subId = side === 'HOME' ? match.homeSchoolTeam : match.awaySchoolTeam;
  const subKind = side === 'HOME'
    ? match.homeSchoolTeamKind : match.awaySchoolTeamKind;
  if (!subId) return false;
  const { FormTeam, ClassTeam } =
    require('../SchoolTeam/school_team.model');
  const Model = subKind === 'ClassTeam' ? ClassTeam : FormTeam;
  const sub = await Model.findById(subId)
    .select('captain assistantCaptain').lean();
  if (!sub) return false;
  return String(sub.captain || '') === String(userId)
    || String(sub.assistantCaptain || '') === String(userId);
}

/**
 * True when userId can act on a specific side (HOME | AWAY) of a
 * match. Covers canManageTeam of the side's team account plus intra
 * sub-team captain / assistant captain for that side. Use this for
 * per-side gates like /confirm (confirming the opposing side's score)
 * and /lineup (each kikosi is owned by its captain).
 */
async function canActOnMatchSide(userId, match, side) {
  if (!userId || !match) return false;
  const teamId = side === 'HOME' ? match.homeTeam : match.awayTeam;
  if (await canManageTeam(userId, teamId)) return true;
  return canActOnIntraMatchSide(userId, match, side);
}

/**
 * Convenience: true when userId can manage EITHER of a match's two
 * teams. Used for cancel/reschedule/result-entry where either side is
 * fine. For intra fixtures (homeTeam === awayTeam === parent school),
 * also recognises sub-team captains / assistant captains of either
 * side via canActOnMatchSide.
 */
async function canManageMatch(userId, match) {
  if (!userId || !match) return false;
  const [home, away] = await Promise.all([
    canActOnMatchSide(userId, match, 'HOME'),
    canActOnMatchSide(userId, match, 'AWAY'),
  ]);
  return home || away;
}

module.exports = {
  SCORE_ACCESS_ROLES,
  canManageTeam,
  canManageMatch,
  canActOnMatchSide,
};
