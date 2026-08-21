const express = require('express');
const { getString } = require('@lykmapipo/env');
const Invitation = require('./invitation.model');
const User = require('../User/user.model');
const Notification = require('../Notification/notification.model');

const API_VERSION = getString('API_VERSION', '1.0.0');
const router = express.Router();
const BASE = `/v${API_VERSION.split('.')[0]}/invitations`;

async function inviterLabel(inviterId) {
  if (!inviterId) return 'Mtu / Somebody';
  const u = await User.findById(inviterId)
    .select('academy_name firstName lastName type')
    .lean();
  if (!u) return 'Mtu / Somebody';
  return (u.academy_name && u.academy_name.trim())
    || `${u.firstName || ''} ${u.lastName || ''}`.trim()
    || u.type
    || 'Mtu';
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
      if (p.school_jersey_number) update.school_jersey_number = p.school_jersey_number;
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
