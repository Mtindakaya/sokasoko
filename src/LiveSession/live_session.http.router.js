const express = require('express');
const { getString } = require('@lykmapipo/env');
const LiveSession = require('./live_session.model');
const User = require('../User/user.model');
const Notification = require('../Notification/notification.model');
const { Subscription } = require('../Subscription/subscription.model');

const API_VERSION = getString('API_VERSION', '1.0.0');
const BASE = `/v${API_VERSION.split('.')[0]}/live-sessions`;
const JITSI_BASE = getString('JITSI_BASE', 'https://meet.jit.si');
const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

const BLOCKED_TYPES = new Set(['PLAYER', 'GUARDIAN']);
// Non-subscription org types that still get a baseline cap so they can
// use the feature without a subscription record. FIELD_OWNER gets 0
// because they're a venue role, not a content role.
const NON_SUB_BASELINE = {
  SCHOOL: 1,
  SPONSOR: 1,
  FOOTBALL_ASSOCIATION: 3,
  FIELD_OWNER: 0,
};

// Returns the monthly LiveSession cap for a user, or `null` for
// unlimited (ENTERPRISE tier). Returns 0 when they can't request
// at all (blocked type, expired sub, wrong tier, etc.).
//
// Uses getEffectiveTier (not getActiveSubscription) so brand-new
// accounts inside their auto-Gold onboarding trial get the GOLD
// cap even without an explicit subscription record. Without this,
// every newly-registered COACH/ACADEMY/CLUB/AGENT would 402.
async function getLiveSessionCap(user) {
  if (!user) return 0;
  if (BLOCKED_TYPES.has(user.type)) return 0;
  if (Object.prototype.hasOwnProperty.call(NON_SUB_BASELINE, user.type)) {
    return NON_SUB_BASELINE[user.type];
  }
  const tier = await Subscription.getEffectiveTier(user._id, user.type);
  if (tier === 'ENTERPRISE') return null;
  if (tier === 'PLATINUM') return 5;
  if (tier === 'GOLD') return 1;
  if (tier === 'PRO' && user.type === 'SCOUT') return 1;
  return 0;
}

async function usedThisMonth(hostId) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  // Counts REQUESTED + APPROVED + LIVE + ENDED so cancellations
  // don't count against the user. Rejects also don't count.
  return LiveSession.countDocuments({
    host: hostId,
    status: { $in: ['REQUESTED', 'APPROVED', 'LIVE', 'ENDED'] },
    scheduledFor: { $gte: start, $lt: end },
  });
}

// Any REQUESTED or APPROVED session whose window overlaps [start, end]
// blocks a new booking. Admin can override by rejecting the conflict
// then approving the new request.
async function hasCollision({ startAt, endAt, ignoreId }) {
  const filter = {
    status: { $in: ['REQUESTED', 'APPROVED', 'LIVE'] },
    scheduledFor: { $lt: endAt },
  };
  if (ignoreId) filter._id = { $ne: ignoreId };
  const candidates = await LiveSession
    .find(filter).select('scheduledFor durationMinutes').lean();
  return candidates.some((c) => {
    const cStart = new Date(c.scheduledFor).getTime();
    const cEnd = cStart + (c.durationMinutes || 60) * 60 * 1000;
    return cStart < endAt.getTime() && cEnd > startAt.getTime();
  });
}

async function isAdmin(userId) {
  if (!userId) return false;
  const u = await User.findById(userId).select('isAdmin').lean();
  return !!(u && u.isAdmin);
}

// Resolve the invitee list for a session: SPECIFIC audience uses the
// stored list; GENERAL pulls every non-blocked user (capped at 2000
// so a single call can't OOM the box).
async function resolveInvitees(session) {
  if (session.audience === 'SPECIFIC') return session.audienceUsers || [];
  const rows = await User.find({ type: { $nin: [...BLOCKED_TYPES] } })
    .select('_id').limit(2000).lean();
  return rows.map((u) => u._id);
}

// Fire-and-forget notification fan-out. Uses Promise.allSettled so
// one bad recipient doesn't poison the batch; wraps in a top-level
// try/catch so any thrown error is swallowed (we've already sent
// the HTTP response before this runs). Logs a summary if any
// notification insert failed so a spike is visible in Render logs.
function fanOutNotifications({ label, invitees, payloadFor }) {
  Promise.allSettled(
    invitees.map((uid) => {
      try {
        return Notification.create(payloadFor(uid));
      } catch (e) {
        return Promise.reject(e);
      }
    })
  ).then((results) => {
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed) {
      console.warn(`[LIVE_SESSION ${label}] ${failed}/${invitees.length} notifications failed`);
    }
  }).catch((e) => {
    console.warn(`[LIVE_SESSION ${label}] fan-out crashed:`, e.message);
  });
}

// ─────────────────────────────────────────────────────────────────────────
// POST /v1/live-sessions — request a new session
// body: { host, title, description, scheduledFor, durationMinutes,
//         audience, audienceUsers }
// ─────────────────────────────────────────────────────────────────────────
router.post(BASE, async (req, res) => {
  try {
    const {
      host, title, description, scheduledFor, durationMinutes,
      audience, audienceUsers,
    } = req.body || {};
    if (!host || !title || !scheduledFor) {
      return res.status(400).json({
        error: 'host, title, scheduledFor required',
      });
    }
    const hostUser = await User.findById(host)
      .select('type firstName lastName academy_name company_name entity_name').lean();
    if (!hostUser) return res.status(404).json({ error: 'Host not found' });
    if (BLOCKED_TYPES.has(hostUser.type)) {
      return res.status(403).json({
        error: 'Aina yako ya akaunti haiwezi kuomba kipindi cha moja kwa moja.',
      });
    }

    // Cap check — bypassed in beta when USAGE_CAPS_DISABLED is on
    // (matches the existing project-wide beta-testing convention).
    const capsDisabled = String(process.env.USAGE_CAPS_DISABLED || '').toLowerCase() === 'true';
    if (!capsDisabled) {
      const cap = await getLiveSessionCap(hostUser);
      if (cap === 0) {
        return res.status(402).json({
          error: 'Kifurushi chako hakikuruhusu kuomba kipindi cha moja kwa moja. Boresha kifurushi.',
          reason: 'TIER_LOCKED',
        });
      }
      if (cap !== null) {
        const used = await usedThisMonth(host);
        if (used >= cap) {
          return res.status(409).json({
            error: `Umefikia kikomo cha vipindi ${cap} kwa mwezi huu.`,
            reason: 'MONTHLY_CAP',
            cap, used,
          });
        }
      }
    }

    // Time-window checks
    const startAt = new Date(scheduledFor);
    if (isNaN(startAt.getTime())) {
      return res.status(400).json({ error: 'scheduledFor si sahihi.' });
    }
    const now = new Date();
    const minStart = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    // 24h advance-notice check is bypassed when LIVE_SESSION_DEV_BYPASS=true
    // on the server (Render env var). See memory
    // project_live_session_dev_bypass — flip this off before launch.
    const bypass24h = String(process.env.LIVE_SESSION_DEV_BYPASS || '')
      .toLowerCase() === 'true';
    if (!bypass24h && startAt < minStart) {
      return res.status(400).json({
        error: 'Kipindi lazima kiwe angalau saa 24 kabla ya sasa.',
        reason: 'ADVANCE_NOTICE',
      });
    }
    const durationMins = Math.min(Math.max(Number(durationMinutes) || 60, 5), 60);
    const endAt = new Date(startAt.getTime() + durationMins * 60 * 1000);

    if (await hasCollision({ startAt, endAt })) {
      return res.status(409).json({
        error: 'Muda huo umegongana na kipindi kingine. Chagua muda mwingine.',
        reason: 'COLLISION',
      });
    }

    const aud = audience === 'SPECIFIC' ? 'SPECIFIC' : 'GENERAL';
    const audUsers = (aud === 'SPECIFIC' && Array.isArray(audienceUsers))
      ? audienceUsers.slice(0, 500) : [];

    const doc = await LiveSession.create({
      host,
      title: String(title).trim(),
      description: String(description || '').trim(),
      scheduledFor: startAt,
      durationMinutes: durationMins,
      audience: aud,
      audienceUsers: audUsers,
      status: 'REQUESTED',
    });

    // Notify all admins — bulk fan-out is fine, admin list is small.
    try {
      const admins = await User.find({ isAdmin: true }).select('_id').lean();
      const hostLabel = (hostUser.academy_name && hostUser.academy_name.trim())
        || (hostUser.company_name && hostUser.company_name.trim())
        || (hostUser.entity_name && hostUser.entity_name.trim())
        || `${hostUser.firstName || ''} ${hostUser.lastName || ''}`.trim()
        || 'Mtumiaji';
      await Promise.all(admins.map((a) => Notification.create({
        userId: a._id,
        type: 'SYSTEM',
        title: 'Ombi Jipya la Kipindi cha Moja kwa Moja',
        body: `${hostLabel} ameomba kufanya kipindi cha "${doc.title}".`,
        titleKey: 'notif.live_session.requested_title',
        bodyKey: 'notif.live_session.requested_body',
        params: { host: hostLabel, title: doc.title },
        metadata: { kind: 'LIVE_SESSION_REQUESTED', liveSessionId: doc._id.toString() },
      })));
    } catch (e) {
      console.log('[LIVE_SESSION requested] notify failed:', e.message);
    }

    return res.status(201).json({ data: doc });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// GET /v1/live-sessions/mine?host=<id>  — host's own list
// GET /v1/live-sessions/host/:userId    — public list on a host's profile
// GET /v1/live-sessions/upcoming/mine?viewer=<id>  — sessions I can watch
// GET /v1/live-sessions/calendar?from=<iso>&to=<iso>  — admin calendar
// ─────────────────────────────────────────────────────────────────────────
router.get(`${BASE}/mine`, async (req, res) => {
  try {
    const host = req.query.host;
    if (!host) return res.status(400).json({ error: 'host required' });
    const list = await LiveSession.find({ host })
      .sort({ scheduledFor: -1 })
      .limit(100)
      .lean();
    return res.json({ data: list });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get(`${BASE}/host/:userId`, async (req, res) => {
  try {
    const list = await LiveSession.find({
      host: req.params.userId,
      status: { $in: ['APPROVED', 'LIVE', 'ENDED'] },
    })
      .sort({ scheduledFor: -1 })
      .limit(50)
      .lean();
    return res.json({ data: list });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get(`${BASE}/upcoming/mine`, async (req, res) => {
  try {
    const viewer = req.query.viewer;
    if (!viewer) return res.status(400).json({ error: 'viewer required' });
    const now = new Date();
    const list = await LiveSession.find({
      status: { $in: ['APPROVED', 'LIVE'] },
      scheduledFor: { $gte: new Date(now.getTime() - 3 * 60 * 60 * 1000) },
      $or: [
        { audience: 'GENERAL' },
        { audience: 'SPECIFIC', audienceUsers: viewer },
      ],
    })
      .populate('host', 'firstName lastName academy_name company_name entity_name type profileImage')
      .sort({ scheduledFor: 1 })
      .limit(50)
      .lean();
    return res.json({ data: list });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get(`${BASE}/calendar`, async (req, res) => {
  try {
    const from = req.query.from ? new Date(req.query.from) : new Date();
    const to = req.query.to
      ? new Date(req.query.to)
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const list = await LiveSession.find({
      status: { $in: ['REQUESTED', 'APPROVED', 'LIVE'] },
      scheduledFor: { $gte: from, $lte: to },
    })
      .populate('host', 'firstName lastName academy_name company_name entity_name type')
      .sort({ scheduledFor: 1 })
      .lean();
    return res.json({ data: list });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Admin actions — POST /:id/approve, /:id/reject
// ─────────────────────────────────────────────────────────────────────────
router.post(`${BASE}/:id/approve`, async (req, res) => {
  try {
    const actor = req.body?.actor;
    if (!(await isAdmin(actor))) {
      return res.status(403).json({ error: 'Admin only.' });
    }
    const s = await LiveSession.findById(req.params.id);
    if (!s) return res.status(404).json({ error: 'Not found' });
    if (s.status !== 'REQUESTED') {
      return res.status(409).json({
        error: `Cannot approve — status is ${s.status}.`,
      });
    }
    // Re-check collision at approval time in case another APPROVED
    // session was scheduled since request came in.
    const endAt = new Date(s.scheduledFor.getTime() + s.durationMinutes * 60 * 1000);
    if (await hasCollision({ startAt: s.scheduledFor, endAt, ignoreId: s._id })) {
      return res.status(409).json({
        error: 'Muda umegongana. Kataa au badilisha wakati.',
        reason: 'COLLISION',
      });
    }
    s.status = 'APPROVED';
    s.approvedBy = actor;
    s.jitsiRoomId = LiveSession.generateRoomId();
    s.jitsiRoomUrl = `${JITSI_BASE}/${s.jitsiRoomId}`;
    await s.save();

    // Respond first — the client only needs to know the approval
    // committed. Notification fan-out (host + audience) runs after
    // this and cannot delay or fail the response.
    res.json({ data: s });

    // Host notification — fan-out of 1, but same fire-and-forget
    // pattern so a stray DB blip doesn't leak past the response.
    fanOutNotifications({
      label: 'approve.host',
      invitees: [s.host],
      payloadFor: () => ({
        userId: s.host,
        type: 'SYSTEM',
        title: 'Ombi lako la Kipindi Limekubaliwa',
        body: `Kipindi chako "${s.title}" kimekubaliwa. Kitaanza ${s.scheduledFor.toISOString()}.`,
        titleKey: 'notif.live_session.approved_title',
        bodyKey: 'notif.live_session.approved_body',
        params: { title: s.title },
        metadata: {
          kind: 'LIVE_SESSION_APPROVED',
          liveSessionId: s._id.toString(),
          scheduledFor: s.scheduledFor.toISOString(),
        },
      }),
    });

    // Audience fan-out — GENERAL walks up to 2000 non-blocked users;
    // SPECIFIC uses the stored list. Async; the response has already
    // gone out.
    resolveInvitees(s).then((invitees) => {
      fanOutNotifications({
        label: 'approve.audience',
        invitees,
        payloadFor: (uid) => ({
          userId: uid,
          type: 'SYSTEM',
          title: 'Alika Kwenye Kipindi cha Moja kwa Moja',
          body: `Umealikwa kwenye kipindi "${s.title}".`,
          titleKey: 'notif.live_session.invite_title',
          bodyKey: 'notif.live_session.invite_body',
          params: { title: s.title },
          metadata: {
            kind: 'LIVE_SESSION_INVITE',
            liveSessionId: s._id.toString(),
            hostId: s.host.toString(),
            scheduledFor: s.scheduledFor.toISOString(),
          },
        }),
      });
    }).catch((e) => {
      console.warn('[LIVE_SESSION approve.audience] resolve failed:', e.message);
    });
    return;
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post(`${BASE}/:id/reject`, async (req, res) => {
  try {
    const actor = req.body?.actor;
    if (!(await isAdmin(actor))) {
      return res.status(403).json({ error: 'Admin only.' });
    }
    const reason = (req.body?.reason || '').toString().slice(0, 300);
    const s = await LiveSession.findById(req.params.id);
    if (!s) return res.status(404).json({ error: 'Not found' });
    if (s.status !== 'REQUESTED') {
      return res.status(409).json({
        error: `Cannot reject — status is ${s.status}.`,
      });
    }
    s.status = 'REJECTED';
    s.approvedBy = actor;
    s.rejectReason = reason;
    await s.save();

    try {
      await Notification.create({
        userId: s.host,
        type: 'SYSTEM',
        title: 'Ombi lako la Kipindi Halikubaliwa',
        body: reason
          ? `Ombi la "${s.title}" halikubaliwa. Sababu: ${reason}`
          : `Ombi la "${s.title}" halikubaliwa.`,
        titleKey: reason ? 'notif.live_session.rejected_reason_body' : 'notif.live_session.rejected_body',
        bodyKey: reason ? 'notif.live_session.rejected_reason_body' : 'notif.live_session.rejected_body',
        params: { title: s.title, reason },
        metadata: { kind: 'LIVE_SESSION_REJECTED', liveSessionId: s._id.toString() },
      });
    } catch (_) {}

    return res.json({ data: s });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Host actions — POST /:id/start, /:id/end, /:id/cancel, /:id/recording
// ─────────────────────────────────────────────────────────────────────────
router.post(`${BASE}/:id/start`, async (req, res) => {
  try {
    const actor = req.body?.actor;
    const s = await LiveSession.findById(req.params.id);
    if (!s) return res.status(404).json({ error: 'Not found' });
    if (String(actor) !== String(s.host)) {
      return res.status(403).json({ error: 'Only the host can start.' });
    }
    if (s.status !== 'APPROVED') {
      return res.status(409).json({ error: `Cannot start — status is ${s.status}.` });
    }
    s.status = 'LIVE';
    s.actualStartedAt = new Date();
    await s.save();

    // Respond first — audience "live now" fan-out happens async so a
    // slow fan-out can't stall the host's start button.
    res.json({ data: s });

    resolveInvitees(s).then((invitees) => {
      fanOutNotifications({
        label: 'start.audience',
        invitees,
        payloadFor: (uid) => ({
          userId: uid,
          type: 'SYSTEM',
          title: 'Kipindi Kimeanza Sasa',
          body: `"${s.title}" kinaendelea sasa. Fungua wasifu wa mwenyeji kuangalia.`,
          titleKey: 'notif.live_session.live_now_title',
          bodyKey: 'notif.live_session.live_now_body',
          params: { title: s.title },
          metadata: {
            kind: 'LIVE_SESSION_LIVE_NOW',
            liveSessionId: s._id.toString(),
            hostId: s.host.toString(),
          },
        }),
      });
    }).catch((e) => {
      console.warn('[LIVE_SESSION start.audience] resolve failed:', e.message);
    });
    return;
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post(`${BASE}/:id/end`, async (req, res) => {
  try {
    const actor = req.body?.actor;
    const s = await LiveSession.findById(req.params.id);
    if (!s) return res.status(404).json({ error: 'Not found' });
    if (String(actor) !== String(s.host) && !(await isAdmin(actor))) {
      return res.status(403).json({ error: 'Only the host or an admin can end.' });
    }
    if (s.status !== 'LIVE') {
      return res.status(409).json({ error: `Cannot end — status is ${s.status}.` });
    }
    s.status = 'ENDED';
    s.actualEndedAt = new Date();
    await s.save();
    return res.json({ data: s });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post(`${BASE}/:id/cancel`, async (req, res) => {
  try {
    const actor = req.body?.actor;
    const s = await LiveSession.findById(req.params.id);
    if (!s) return res.status(404).json({ error: 'Not found' });
    if (String(actor) !== String(s.host) && !(await isAdmin(actor))) {
      return res.status(403).json({ error: 'Only the host or an admin can cancel.' });
    }
    if (!['REQUESTED', 'APPROVED'].includes(s.status)) {
      return res.status(409).json({ error: `Cannot cancel — status is ${s.status}.` });
    }
    s.status = 'CANCELLED';
    s.cancelReason = (req.body?.reason || '').toString().slice(0, 300);
    await s.save();
    return res.json({ data: s });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Phase 1.5 stub — host or admin can paste in a YouTube URL after the
// session ends. Automatic upload lands with JaaS/Jibri.
router.post(`${BASE}/:id/recording`, async (req, res) => {
  try {
    const actor = req.body?.actor;
    const url = (req.body?.youtubeUrl || '').toString().trim();
    if (!/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(url)) {
      return res.status(400).json({ error: 'youtubeUrl si sahihi.' });
    }
    const s = await LiveSession.findById(req.params.id);
    if (!s) return res.status(404).json({ error: 'Not found' });
    if (String(actor) !== String(s.host) && !(await isAdmin(actor))) {
      return res.status(403).json({ error: 'Only host or admin.' });
    }
    s.recordingUrl = url;
    await s.save();
    return res.json({ data: s });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
