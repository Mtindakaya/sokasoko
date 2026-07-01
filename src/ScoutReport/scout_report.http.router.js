const express = require('express');
const { getString } = require('@lykmapipo/env');
const mongoose = require('mongoose');
const ScoutReport = require('./scout_report.model');

const API_VERSION = getString('API_VERSION', '1.0.0');
const router = express.Router();
const BASE = `/v${API_VERSION.split('.')[0]}/scout-reports`;

// POST /v1/scout-reports — submit an evaluation
router.post(BASE, async (req, res) => {
  try {
    const report = await ScoutReport.create(req.body);
    const populated = await ScoutReport.findById(report._id)
      .populate('scout', 'firstName lastName type accountNumber')
      .populate('player', 'firstName lastName type position accountNumber profileImage');
    return res.status(201).json({ data: populated });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/scout-reports — fetch reports for a user
// ?userId=&userType=   (SCOUT → reports authored by this scout)
//                      (PLAYER → reports about this player)
router.get(BASE, async (req, res) => {
  try {
    const { userId, userType } = req.query;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    let filter = {};
    if (userType === 'SCOUT' || userType === 'COACH') {
      filter.scout = userId;
    } else {
      filter.player = userId;
    }

    const reports = await ScoutReport.find(filter)
      .populate('scout', 'firstName lastName type accountNumber')
      .populate('player', 'firstName lastName type position accountNumber profileImage')
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    // Enrich each report with its event (match or trial) data
    const Match = mongoose.model('Match');
    const Trial = mongoose.model('Trial');

    const matchIds = reports.filter(r => r.eventType === 'MATCH').map(r => r.eventId);
    const trialIds = reports.filter(r => r.eventType === 'TRIAL').map(r => r.eventId);

    const [matches, trials] = await Promise.all([
      matchIds.length
        ? Match.find({ _id: { $in: matchIds } })
            .select('_id scheduledDate homeTeam awayTeam')
            .populate('homeTeam', 'firstName lastName academy_name academyName')
            .populate('awayTeam', 'firstName lastName academy_name academyName')
            .lean()
        : [],
      trialIds.length
        ? Trial.find({ _id: { $in: trialIds } })
            .select('_id title startDate location')
            .lean()
        : [],
    ]);

    const matchMap = Object.fromEntries(matches.map(m => [m._id.toString(), m]));
    const trialMap = Object.fromEntries(trials.map(t => [t._id.toString(), t]));

    const enriched = reports.map(r => {
      if (r.eventType === 'MATCH') {
        r.eventData = matchMap[r.eventId] || null;
      } else {
        r.eventData = trialMap[r.eventId] || null;
      }
      return r;
    });

    return res.status(200).json({ data: enriched });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
