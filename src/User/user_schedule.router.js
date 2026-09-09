const express = require('express');
const { getString } = require('@lykmapipo/env');
const mongoose = require('mongoose');
const Match = require('../Match/match.model');
const Trial = require('../Trial/trial.model');
const Tournament = require('../Tournament/tournament.model');
const LiveSession = require('../LiveSession/live_session.model');

const API_VERSION = getString('API_VERSION', '1.0.0');
const BASE = `/v${API_VERSION.split('.')[0]}/users`;
const router = express.Router();

// GET /v1/users/:id/schedule?from=<iso>&to=<iso>&limit=20
// Aggregates upcoming broadcast events on a user's account across
// Match, Trial (with Clinic sub-type), Tournament, and LiveSession.
// The client uses this to decide whether to show the profile pane's
// "Ratiba" (schedule) tab at all — empty result means no tab.
router.get(`${BASE}/:id/schedule`, async (req, res) => {
  try {
    const userId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }
    const oid = new mongoose.Types.ObjectId(userId);

    const from = req.query.from ? new Date(req.query.from) : new Date();
    const to = req.query.to
      ? new Date(req.query.to)
      : new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    const limit = Math.min(parseInt(req.query.limit || '20', 10), 100);

    // Kick off all five queries in parallel so the aggregation is a
    // single round-trip's worth of latency.
    const [matches, trialsAndClinics, tournaments, liveSessions] =
      await Promise.all([
        Match.find({
          $or: [{ homeTeam: oid }, { awayTeam: oid }],
          scheduledDate: { $gte: from, $lte: to },
        })
          .select('_id homeTeam awayTeam scheduledDate venue')
          .populate('homeTeam', 'firstName lastName academy_name type')
          .populate('awayTeam', 'firstName lastName academy_name type')
          .sort({ scheduledDate: 1 })
          .lean(),
        Trial.find({
          organizer: oid,
          startDate: { $gte: from, $lte: to },
        })
          .select('_id title eventType startDate endDate location')
          .sort({ startDate: 1 })
          .lean(),
        Tournament.find({
          organizer: oid,
          startDate: { $gte: from, $lte: to },
        })
          .select('_id name title startDate endDate')
          .sort({ startDate: 1 })
          .lean(),
        LiveSession.find({
          host: oid,
          scheduledFor: { $gte: from, $lte: to },
          status: { $in: ['APPROVED', 'LIVE'] },
        })
          .select('_id title scheduledFor durationMinutes status')
          .sort({ scheduledFor: 1 })
          .lean(),
      ]);

    // Normalize into a uniform envelope so the client renders one
    // agenda list.
    const rows = [];
    const label = (u) =>
      (u && u.academy_name && u.academy_name.trim())
      || (u && `${u.firstName || ''} ${u.lastName || ''}`.trim())
      || 'Timu';

    for (const m of matches) {
      rows.push({
        type: 'MATCH',
        id: m._id.toString(),
        title: `${label(m.homeTeam)} vs ${label(m.awayTeam)}`,
        when: m.scheduledDate,
        durationMinutes: 120,
      });
    }
    for (const t of trialsAndClinics) {
      rows.push({
        type: t.eventType === 'CLINIC' ? 'CLINIC' : 'TRIAL',
        id: t._id.toString(),
        title: t.title || (t.eventType === 'CLINIC' ? 'Clinic' : 'Trial'),
        when: t.startDate,
        endsAt: t.endDate || null,
      });
    }
    for (const t of tournaments) {
      rows.push({
        type: 'TOURNAMENT',
        id: t._id.toString(),
        title: t.name || t.title || 'Tournament',
        when: t.startDate,
        endsAt: t.endDate || null,
      });
    }
    for (const s of liveSessions) {
      rows.push({
        type: 'LIVE_SESSION',
        id: s._id.toString(),
        title: s.title,
        when: s.scheduledFor,
        durationMinutes: s.durationMinutes || 60,
        status: s.status,
      });
    }

    rows.sort((a, b) => new Date(a.when) - new Date(b.when));
    return res.json({ data: rows.slice(0, limit), total: rows.length });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
