// Match-action notification fan-out. Every score-relevant interaction
// (schedule, result entry, confirm, cancel, reschedule, schedule
// confirm/decline) is broadcast to every user with score access on
// both teams — the team account itself plus its ACTIVE staff in
// roles that hold match authority.
//
// Kept as a standalone module so the wiring in match.http.router.js
// stays a one-liner per endpoint.

const User = require('../User/user.model');
const Notification = require('../Notification/notification.model');
const OrgStaffLink = require('../OrgStaff/org_staff.model');
const { sendPush } = require('../Notification/push_sender');

// Roles that hold "score access" — team account itself + these 4
// OrgStaff roles form the notified set. OTHER + custom roles are
// chat-only, no elevated authority, so they're NOT included.
const SCORE_ACCESS_ROLES = ['OWNER', 'MANAGER', 'COACH', 'SECRETARY'];

/**
 * Return the list of userIds to notify for a given team.
 * = the team account itself + every ACTIVE OrgStaffLink.staff where
 *   role ∈ SCORE_ACCESS_ROLES.
 * Pass excludeId to filter out the acting user so they don't get
 * their own action pinged back at them.
 */
async function getTeamRecipients(teamId, excludeId) {
  if (!teamId) return [];
  const teamIdStr = String(teamId);
  const links = await OrgStaffLink
    .find({ org: teamId, status: 'ACTIVE', role: { $in: SCORE_ACCESS_ROLES } })
    .select('staff')
    .lean();
  const set = new Set([teamIdStr]);
  for (const l of links) {
    if (l.staff) set.add(String(l.staff));
  }
  if (excludeId) set.delete(String(excludeId));
  return Array.from(set);
}

// Team display-name helper. Prefers academy_name, falls back to
// human name so club/school/individual accounts read sensibly.
function labelUser(u) {
  if (!u) return '';
  return (u.academy_name && u.academy_name.trim())
    || (u.company_name && u.company_name.trim())
    || (u.entity_name && u.entity_name.trim())
    || `${u.firstName || ''} ${u.lastName || ''}`.trim()
    || '';
}

async function fetchMatchParties(match, actorId) {
  const ids = [match.homeTeam, match.awayTeam].filter(Boolean);
  if (actorId) ids.push(actorId);
  const users = await User.find({ _id: { $in: ids } })
    .select('firstName lastName academy_name company_name entity_name')
    .lean();
  const byId = new Map(users.map(u => [String(u._id), u]));
  const home = byId.get(String(match.homeTeam));
  const away = byId.get(String(match.awayTeam));
  const actor = actorId ? byId.get(String(actorId)) : null;
  return {
    home,
    away,
    actor,
    homeLabel: labelUser(home) || 'Timu ya nyumbani',
    awayLabel: labelUser(away) || 'Timu ya ugenini',
    actorLabel: labelUser(actor) || 'Mfanyakazi',
    matchLabel: `${labelUser(home) || 'Home'} vs ${labelUser(away) || 'Away'}`,
  };
}

function isoDate(d) {
  try { return new Date(d).toISOString(); } catch (_) { return null; }
}

/**
 * Fan out a single kind of notification to both teams' recipients.
 * Bilingual title/body strings so both sw and en users get a
 * readable notification without needing a client-side L10n lookup.
 *
 * kind: enum controlling the copy. See CASES below.
 * extras: optional { newDate, side ('HOME'|'AWAY'), reason } for
 *         kinds that need it (reschedule, confirm-side, decline).
 */
async function notifyMatchAction({ match, kind, actorId, extras = {} }) {
  if (!match || !kind) return;
  try {
    const parties = await fetchMatchParties(match, actorId);
    const [homeRecipients, awayRecipients] = await Promise.all([
      getTeamRecipients(match.homeTeam, actorId),
      getTeamRecipients(match.awayTeam, actorId),
    ]);
    // Dedupe across teams — a rare case (shared staff) but the DB
    // would happily double-insert otherwise.
    const combined = Array.from(new Set([...homeRecipients, ...awayRecipients]));

    const copy = renderCopy(kind, parties, extras);
    if (!copy) return;

    const baseMetadata = {
      kind,
      matchId: match._id,
      scheduledDate: match.scheduledDate,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
    };

    await Promise.all(combined.map(userId => Notification.create({
      userId,
      type: 'SYSTEM',
      title: copy.title,
      body: copy.body,
      titleKey: copy.titleKey,
      bodyKey: copy.bodyKey,
      params: copy.params,
      metadata: baseMetadata,
    })));

    // Device push, fire-and-forget. Category 'myMatches' covers the
    // team + staff recipients; sendPush respects each user's prefs.
    combined.forEach(userId => sendPush({
      userId,
      category: 'myMatches',
      title: copy.title,
      body: copy.body,
      titleKey: copy.titleKey,
      bodyKey: copy.bodyKey,
      params: copy.params,
      data: { matchId: String(match._id), kind },
    }).catch(() => {}));

    // Favourites fan-out. Fires on MATCH_COMPLETED (the score close-out)
    // so followers get a "Full-time: Team A 3-1 Team B" ping. Excludes
    // anyone already notified via team/staff so nobody gets it twice.
    if (kind === 'MATCH_COMPLETED') {
      try {
        const fans = await User.find({
          $or: [
            { favoriteTeams: match.homeTeam },
            { favoriteTeams: match.awayTeam },
          ],
        }).select('_id').lean();
        const alreadyNotified = new Set(combined.map(String));
        const homeScore = match.homeScore ?? '';
        const awayScore = match.awayScore ?? '';
        const favBody =
          `Muda kamili: ${parties.homeLabel} ${homeScore} - ${awayScore} ${parties.awayLabel}.`;
        fans.forEach(f => {
          const uid = String(f._id);
          if (alreadyNotified.has(uid)) return;
          Notification.create({
            userId: uid,
            type: 'SYSTEM',
            title: 'Timu yako imemaliza mechi',
            body: favBody,
            titleKey: 'notif.favourite.match_completed.title',
            bodyKey: 'notif.favourite.match_completed.body',
            params: {
              home: parties.homeLabel,
              away: parties.awayLabel,
              homeScore: String(homeScore),
              awayScore: String(awayScore),
            },
            metadata: { ...baseMetadata, kind: 'FAVOURITE_MATCH_COMPLETED' },
          }).catch(() => {});
          sendPush({
            userId: uid,
            category: 'favourites',
            title: 'Timu yako imemaliza mechi',
            body: favBody,
            titleKey: 'notif.favourite.match_completed.title',
            bodyKey: 'notif.favourite.match_completed.body',
            params: {
              home: parties.homeLabel,
              away: parties.awayLabel,
              homeScore: String(homeScore),
              awayScore: String(awayScore),
            },
            data: { matchId: String(match._id), kind: 'FAVOURITE_MATCH_COMPLETED' },
          }).catch(() => {});
        });
      } catch (err) {
        console.log('[match_notifications] favourite fan-out failed:', err.message);
      }
    }
  } catch (err) {
    // Notifications must never break the action they follow.
    // eslint-disable-next-line no-console
    console.log('[match_notifications] fan-out failed:', err.message);
  }
}

// Notification copy. `title` / `body` are the Kiswahili fallback the
// client uses when its L10n dictionary is missing the key (or the
// notification pre-dates the key landing). Live rendering goes
// through titleKey/bodyKey + params so English-toggle users get the
// English string from their local dictionary — no mixed-language
// strings ever end up on-screen.
function renderCopy(kind, p, extras) {
  const { homeLabel, awayLabel, matchLabel, actorLabel } = p;
  const when = extras.newDate ? isoDate(extras.newDate) : isoDate(p && p.home ? undefined : null);
  const sideLabel = extras.side === 'HOME' ? homeLabel : (extras.side === 'AWAY' ? awayLabel : null);

  switch (kind) {
    case 'MATCH_SCHEDULED':
      return {
        title: 'Mechi mpya imepangwa',
        body:
          `${actorLabel} amepanga mechi: ${matchLabel}. ` +
          `Fungua Mechi ili kukagua tarehe na uwanja.`,
        titleKey: 'notif.match.scheduled.title',
        bodyKey: 'notif.match.scheduled.body',
        params: { actor: actorLabel, match: matchLabel },
      };
    case 'MATCH_RESULT_SAVED':
      return {
        title: 'Matokeo yamewekwa',
        body:
          `${actorLabel} ameweka matokeo ya mechi ${matchLabel}. ` +
          `Kagua na thibitisha upande wako.`,
        titleKey: 'notif.match.result_saved.title',
        bodyKey: 'notif.match.result_saved.body',
        params: { actor: actorLabel, match: matchLabel },
      };
    case 'MATCH_SCORE_CONFIRMED':
      return {
        title: 'Upande umethibitisha matokeo',
        body:
          `${sideLabel || actorLabel} amethibitisha matokeo ya mechi ${matchLabel}. ` +
          `Fungua mechi kuthibitisha upande wako.`,
        titleKey: 'notif.match.score_confirmed.title',
        bodyKey: 'notif.match.score_confirmed.body',
        params: { side: sideLabel || actorLabel, match: matchLabel },
      };
    case 'MATCH_COMPLETED':
      return {
        title: 'Mechi imefungwa',
        body: `Mechi ${matchLabel} imefungwa rasmi. Hakuna mabadiliko zaidi.`,
        titleKey: 'notif.match.completed.title',
        bodyKey: 'notif.match.completed.body',
        params: { match: matchLabel },
      };
    case 'MATCH_CANCELLED':
      return {
        title: 'Mechi imefutwa',
        body: `${actorLabel} amefuta mechi ${matchLabel}.`,
        titleKey: 'notif.match.cancelled.title',
        bodyKey: 'notif.match.cancelled.body',
        params: { actor: actorLabel, match: matchLabel },
      };
    case 'MATCH_RESCHEDULED':
      return {
        title: 'Mechi imehamishwa',
        body:
          `${actorLabel} amehamisha mechi ${matchLabel} kwenda ${when || 'tarehe mpya'}.`,
        titleKey: 'notif.match.rescheduled.title',
        bodyKey: 'notif.match.rescheduled.body',
        params: { actor: actorLabel, match: matchLabel, when },
      };
    case 'MATCH_SCHEDULE_CONFIRMED':
      return {
        title: 'Ratiba imethibitishwa',
        body: `${actorLabel} amethibitisha ratiba ya mechi ${matchLabel}.`,
        titleKey: 'notif.match.schedule_confirmed.title',
        bodyKey: 'notif.match.schedule_confirmed.body',
        params: { actor: actorLabel, match: matchLabel },
      };
    case 'MATCH_SCHEDULE_DECLINED':
      return {
        title: 'Ratiba imekataliwa',
        body:
          `${actorLabel} amekataa ratiba ya mechi ${matchLabel}` +
          `${extras.reason ? `: ${extras.reason}` : ''}.`,
        titleKey: 'notif.match.schedule_declined.title',
        bodyKey: 'notif.match.schedule_declined.body',
        params: { actor: actorLabel, match: matchLabel, reason: extras.reason || '' },
      };
    default:
      return null;
  }
}

module.exports = {
  SCORE_ACCESS_ROLES,
  getTeamRecipients,
  notifyMatchAction,
};
