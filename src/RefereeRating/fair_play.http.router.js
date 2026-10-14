const express = require('express');
const { getString } = require('@lykmapipo/env');
const FairPlayRating = require('./fair_play.model');
const Match = require('../Match/match.model');

const API_VERSION = getString('API_VERSION', '1.0.0');
const router = express.Router();

// POST /v1/matches/:matchId/fair-play
// Body: { side: 'home' | 'away', score: 0..9, notes?: string }
// Headed by the match referee. Writes/upserts one FairPlayRating per
// (match, team). Resubmission overwrites so the ref can correct a
// slip. The match must be in COMPLETED state.
router.post(`/v${API_VERSION.split('.')[0]}/matches/:matchId/fair-play`,
  async (req, res) => {
    try {
      const { side, score, notes, ratedBy } = req.body || {};
      if (side !== 'home' && side !== 'away') {
        return res.status(400).json({
          error: "side must be 'home' or 'away'",
          errorKey: 'fair_play.err.side',
        });
      }
      const num = Number(score);
      if (!Number.isInteger(num) || num < 0 || num > 9) {
        return res.status(400).json({
          error: 'score must be an integer 0..9',
          errorKey: 'fair_play.err.score',
        });
      }
      const match = await Match.findById(req.params.matchId)
        .select('homeTeam awayTeam referee status').lean();
      if (!match) {
        return res.status(404).json({
          error: 'Match not found', errorKey: 'fair_play.err.not_found',
        });
      }
      if (match.status !== 'COMPLETED') {
        return res.status(400).json({
          error: 'Fair play rating is only accepted on completed matches',
          errorKey: 'fair_play.err.not_completed',
        });
      }
      // ratedBy comes from the client (same pattern as other routes
      // until the auth middleware lands). Must equal the match's
      // referee so a random caller can't rate.
      if (!ratedBy || String(ratedBy) !== String(match.referee || '')) {
        return res.status(403).json({
          error: 'Only the match referee can submit fair play ratings',
          errorKey: 'fair_play.err.not_ref',
        });
      }
      const team = side === 'home' ? match.homeTeam : match.awayTeam;
      const opponent = side === 'home' ? match.awayTeam : match.homeTeam;
      const doc = await FairPlayRating.findOneAndUpdate(
        { match: match._id, team },
        {
          $set: {
            opponent,
            score: num,
            notes: (notes || '').toString().trim(),
            ratedBy,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      return res.status(200).json({ data: doc });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

// GET /v1/matches/:matchId/fair-play
// Returns the two ratings (home + away) for the match, if any — used
// by the ref screen to show what's already submitted so a second
// visit doesn't look like a fresh form.
router.get(`/v${API_VERSION.split('.')[0]}/matches/:matchId/fair-play`,
  async (req, res) => {
    try {
      const rows = await FairPlayRating.find({ match: req.params.matchId })
        .lean();
      return res.status(200).json({ data: rows });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

// GET /v1/users/:teamId/fair-play
// Aggregate for a team. Public-safe payload: last-5 average +
// count. The admin / FA-facing list of raw rows comes from the
// /reports sibling route.
router.get(`/v${API_VERSION.split('.')[0]}/users/:teamId/fair-play`,
  async (req, res) => {
    try {
      const rows = await FairPlayRating.find({ team: req.params.teamId })
        .select('score createdAt')
        .sort({ createdAt: -1 })
        .limit(5)
        .lean();
      const count = rows.length;
      const avg = count === 0
        ? null
        : rows.reduce((s, r) => s + r.score, 0) / count;
      return res.status(200).json({
        data: { avgLast5: avg, countLast5: count },
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

// GET /v1/users/:teamId/fair-play/reports
// Full list for admin / associations — each row populated with
// match + opponent + ref metadata.
router.get(
  `/v${API_VERSION.split('.')[0]}/users/:teamId/fair-play/reports`,
  async (req, res) => {
    try {
      const rows = await FairPlayRating.find({ team: req.params.teamId })
        .populate('match', 'homeTeam awayTeam scheduledFor status')
        .populate('opponent', 'academy_name firstName lastName type')
        .populate('ratedBy', 'firstName lastName accountNumber')
        .sort({ createdAt: -1 })
        .lean();
      return res.status(200).json({ data: rows });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

module.exports = router;
