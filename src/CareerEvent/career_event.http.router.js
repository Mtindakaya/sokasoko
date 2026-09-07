const express = require('express');
const { getString } = require('@lykmapipo/env');
const CareerEvent = require('./career_event.model');
const User = require('../User/user.model');

const API_VERSION = getString('API_VERSION', '1.0.0');
const BASE = `/v${API_VERSION.split('.')[0]}`;
const router = express.Router();

// GET /v1/users/:userId/career-events
// Returns a user's post-registration organisational history newest
// first. Open stints (leftAt == null) surface at the top of that
// sort within their year so the CV can render the current team on
// top.
router.get(`${BASE}/users/:userId/career-events`, async (req, res) => {
  try {
    const events = await CareerEvent.find({ player: req.params.userId })
      .populate('entity',
        'firstName lastName academy_name company_name entity_name ' +
        'type profileImage region district')
      .sort({ leftAt: 1, joinedAt: -1 })
      .lean();
    return res.status(200).json({ data: events });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// PATCH /v1/career-events/:id
// Coach-only fields: coachRole, coachRoleOther, ageLevels. Everything
// else on the event is system-owned. Actor must be the player on the
// event (coach editing their own linked-academy stint).
router.patch(`${BASE}/career-events/:id`, async (req, res) => {
  try {
    const event = await CareerEvent.findById(req.params.id);
    if (!event) return res.status(404).json({ error: 'Not found' });

    const actor = req.body?.actor;
    if (!actor || String(actor) !== String(event.player)) {
      return res.status(403).json({
        error: 'Ni mchezaji/kocha mwenyewe pekee anayeweza kubadili.',
      });
    }
    if (event.role !== 'COACH') {
      return res.status(400).json({
        error: 'Coach-only fields — this event is not a coaching stint.',
      });
    }

    const patch = {};
    if (typeof req.body.coachRole === 'string') {
      patch.coachRole = req.body.coachRole;
    }
    if (typeof req.body.coachRoleOther === 'string') {
      patch.coachRoleOther = req.body.coachRoleOther.trim();
    }
    if (Array.isArray(req.body.ageLevels)) {
      patch.ageLevels = req.body.ageLevels;
    }

    const updated = await CareerEvent.findByIdAndUpdate(
      event._id, { $set: patch }, { new: true }
    ).lean();
    return res.status(200).json({ data: updated });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
