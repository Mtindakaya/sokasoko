const express = require('express');
const { getString } = require('@lykmapipo/env');
const Invitation = require('./invitation.model');
const User = require('../User/user.model');
const Notification = require('../Notification/notification.model');

const API_VERSION = getString('API_VERSION', '1.0.0');
const router = express.Router();
const BASE = `/v${API_VERSION.split('.')[0]}/invitations`;

const { entityLabel } = require('../Utils/utils');

async function inviterLabel(inviterId) {
  if (!inviterId) return 'Mtu / Somebody';
  const u = await User.findById(inviterId)
    .select('type firstName lastName academy_name entity_name company_name football_field_name')
    .lean();
  if (!u) return 'Mtu / Somebody';
  return entityLabel(u) || u.type || 'Mtu';
}

function kindLabel(kind) {
  if (kind === 'SCHOOL_LINK') return 'School';
  if (kind === 'AGENT_LINK') return 'Agent';
  return kind;
}

// POST /v1/invitations — create a PENDING invitation.
// Body: { invitee, inviter, kind, payload? }
router.post(BASE, async (req, res) => {
  try {
    const { invitee, inviter, kind, payload } = req.body || {};
    if (!invitee || !inviter || !kind) {
      return res.status(400).json({
        error: 'invitee, inviter and kind are required',
      });
    }
    if (!Invitation.KINDS.includes(kind)) {
      return res.status(400).json({ error: `invalid kind: ${kind}` });
    }
    // 2026-10-10 — SCHOOL_LINK invitation flow retired. Players now
    // self-associate via POST /v1/users/:id/join-school; sports teachers
    // tick verify from the School Players screen. Reject new SCHOOL_LINK
    // requests so clients cannot keep creating pending rows. Existing
    // in-flight PENDING rows are left alone (they'll sit idle; the
    // Verifications screen on mobile no longer surfaces them).
    if (kind === 'SCHOOL_LINK') {
      return res.status(410).json({
        error: 'SCHOOL_LINK invitations are no longer accepted. '
          + 'Players should join their school directly from signup or '
          + 'Edit Profile.',
      });
    }
    if (String(invitee) === String(inviter)) {
      return res.status(400).json({ error: 'Cannot invite yourself' });
    }

    const invitedUser = await User.findById(invitee)
      .select('type school agent guardian guardianOrphaned').lean();
    if (!invitedUser) {
      return res.status(404).json({ error: 'Invitee not found' });
    }

    // Guard against duplicate PENDING invites of the same kind from the
    // same inviter to the same invitee.
    const dup = await Invitation.findOne({
      invitee, inviter, kind, status: 'PENDING',
    }).lean();
    if (dup) {
      return res.status(400).json({
        error: 'Ombi lako la awali linasubiri majibu. A previous invitation is still pending.',
      });
    }

    // Reject if the association is already live (VERIFIED elsewhere)
    if (kind === 'SCHOOL_LINK' && invitedUser.school) {
      return res.status(400).json({
        error: 'Mchezaji tayari yuko shule. Player is already enrolled in a school.',
      });
    }

    // 30-player cap on the school team roster. If this invitation
    // includes roster membership, make sure the school isn't already
    // full before accepting the request. Payload uses string booleans
    // because the invitation payload is a free-form map.
    if (kind === 'SCHOOL_LINK' && payload
        && (payload.school_roster_member === true
          || payload.school_roster_member === 'true')) {
      const rosterCount = await User.countDocuments({
        school: inviter,
        school_roster_member: true,
      });
      if (rosterCount >= 30) {
        return res.status(400).json({
          error:
            'Orodha ya timu ya shule imejaa (30/30). '
            + 'School team roster is full (30/30).',
        });
      }
    }
    if (kind === 'AGENT_LINK' && invitedUser.agent) {
      return res.status(400).json({
        error: 'Mchezaji tayari ana agent. Player already has an agent.',
      });
    }

    const inv = await Invitation.create({
      invitee, inviter, kind, payload: payload || {},
      status: 'PENDING',
    });

    try {
      const label = await inviterLabel(inviter);
      await Notification.create({
        userId: invitee,
        type: 'SYSTEM',
        title: `Ombi la ${kindLabel(kind)}`,
        body:
          `${label} amekuomba kama ${kindLabel(kind)}. ` +
          `Fungua Uhakiki kwenye wasifu wako kuthibitisha au kukataa.`,
        titleKey: 'notif.invitation.received.title',
        bodyKey: 'notif.invitation.received.body',
        params: { kind: kindLabel(kind), label },
        metadata: {
          kind: `${kind}_INVITE`,
          invitationId: inv._id,
          inviter,
        },
      });
    } catch (nErr) {
      console.log('[INVITATION POST] notification failed:', nErr.message);
    }

    return res.status(201).json({ data: inv });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/invitations/pending/:playerId — invites awaiting decision.
router.get(`${BASE}/pending/:playerId`, async (req, res) => {
  try {
    const rows = await Invitation.find({
      invitee: req.params.playerId,
      status: 'PENDING',
    })
      .populate('inviter', 'firstName lastName academy_name type accountNumber profileImage')
      .sort({ createdAt: -1 })
      .lean();
    return res.status(200).json({ data: rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/invitations/:id/verify — player accepts. Apply the actual
// association on User + flip status. Guardian fan-out handles copies.
router.post(`${BASE}/:id/verify`, async (req, res) => {
  try {
    const inv = await Invitation.findById(req.params.id);
    if (!inv) return res.status(404).json({ error: 'Invitation not found' });
    if (inv.status === 'VERIFIED') return res.status(200).json({ data: inv });
    if (inv.status === 'REJECTED') {
      return res.status(400).json({ error: 'Invitation was previously declined' });
    }

    const update = {};
    if (inv.kind === 'SCHOOL_LINK') {
      update.school = inv.inviter;
      const p = inv.payload || {};
      if (p.school_class) update.school_class = p.school_class;
      if (p.school_form) update.school_form = p.school_form;
      if (p.college_program) update.college_program = p.college_program;
      if (p.college_year) update.college_year = p.college_year;
      if (p.school_jersey_number) update.school_jersey_number = p.school_jersey_number;
      // Re-check the 30-cap at verify time in case other invites were
      // accepted between invitation and verification.
      if (p.school_roster_member === true || p.school_roster_member === 'true') {
        const rosterCount = await User.countDocuments({
          school: inv.inviter,
          school_roster_member: true,
        });
        if (rosterCount >= 30) {
          return res.status(400).json({
            error:
              'Orodha ya timu ya shule imejaa (30/30). '
              + 'School team roster is full (30/30).',
          });
        }
        update.school_roster_member = true;
      }
    } else if (inv.kind === 'AGENT_LINK') {
      update.agent = inv.inviter;
    }

    await User.findByIdAndUpdate(inv.invitee, { $set: update });
    inv.status = 'VERIFIED';
    inv.verifiedAt = new Date();
    await inv.save();

    try {
      const label = await inviterLabel(inv.inviter);
      await Notification.create({
        userId: inv.invitee,
        type: 'SYSTEM',
        title: `${kindLabel(inv.kind)} Imethibitishwa`,
        body:
          `Umeikubali ${label} kama ${kindLabel(inv.kind)}.`,
        titleKey: 'notif.invitation.confirmed.title',
        bodyKey: 'notif.invitation.confirmed.body',
        params: { kind: kindLabel(inv.kind), label },
        metadata: {
          kind: `${inv.kind}_VERIFIED`,
          invitationId: inv._id,
        },
      });
      await Notification.create({
        userId: inv.inviter,
        type: 'SYSTEM',
        title: 'Ombi Limekubaliwa',
        body:
          `Mchezaji amekubali ombi lako la ${kindLabel(inv.kind)}.`,
        titleKey: 'notif.invitation.accepted.title',
        bodyKey: 'notif.invitation.accepted.body',
        params: { kind: kindLabel(inv.kind) },
        metadata: {
          kind: `${inv.kind}_ACCEPTED_BY_PLAYER`,
          invitationId: inv._id,
          playerId: inv.invitee,
        },
      });
    } catch (nErr) {
      console.log('[INVITATION VERIFY] notification failed:', nErr.message);
    }

    return res.status(200).json({ data: inv });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/invitations/:id/reject — player declines. No linkage,
// row kept for audit.
router.post(`${BASE}/:id/reject`, async (req, res) => {
  try {
    const reason = (req.body && req.body.reason ? String(req.body.reason) : '').slice(0, 300);
    const inv = await Invitation.findById(req.params.id);
    if (!inv) return res.status(404).json({ error: 'Invitation not found' });
    if (inv.status === 'REJECTED') return res.status(200).json({ data: inv });
    if (inv.status === 'VERIFIED') {
      return res.status(400).json({
        error: 'Already verified — remove the association from your profile to undo.',
      });
    }
    inv.status = 'REJECTED';
    inv.rejectedAt = new Date();
    inv.rejectReason = reason || '';
    await inv.save();

    try {
      const label = await inviterLabel(inv.inviter);
      await Notification.create({
        userId: inv.inviter,
        type: 'SYSTEM',
        title: 'Ombi Limekataliwa',
        body:
          `Mchezaji amekataa ombi lako la ${kindLabel(inv.kind)}` +
          (reason ? ` (sababu: ${reason})` : '') + '.',
        titleKey: 'notif.invitation.declined.title',
        bodyKey: reason
          ? 'notif.invitation.declined.body_with_reason'
          : 'notif.invitation.declined.body',
        params: reason
          ? { kind: kindLabel(inv.kind), reason }
          : { kind: kindLabel(inv.kind) },
        metadata: {
          kind: `${inv.kind}_DECLINED_BY_PLAYER`,
          invitationId: inv._id,
          playerId: inv.invitee,
          reason: reason || null,
        },
      });
    } catch (nErr) {
      console.log('[INVITATION REJECT] notification failed:', nErr.message);
    }

    return res.status(200).json({ data: inv });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
