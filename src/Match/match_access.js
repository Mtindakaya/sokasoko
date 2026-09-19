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
 * Convenience: true when userId can manage EITHER of a match's
 * two teams. Used for cancel/reschedule where either side is fine.
 */
async function canManageMatch(userId, match) {
  if (!userId || !match) return false;
  const [home, away] = await Promise.all([
    canManageTeam(userId, match.homeTeam),
    canManageTeam(userId, match.awayTeam),
  ]);
  return home || away;
}

module.exports = {
  SCORE_ACCESS_ROLES,
  canManageTeam,
  canManageMatch,
};
