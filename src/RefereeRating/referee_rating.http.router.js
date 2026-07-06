const express = require('express');
const { getString } = require('@lykmapipo/env');
const RefereeRating = require('./referee_rating.model');
const Match = require('../Match/match.model');

const API_VERSION = getString('API_VERSION', '1.0.0');
const router = express.Router();
const BASE = `/v${API_VERSION.split('.')[0]}/referee-ratings`;

function computeTier(avg) {
  if (avg >= 4.2) return 'Excellent';
  if (avg >= 3.4) return 'Very Good';
  if (avg >= 2.6) return 'Good';
  if (avg >= 1.8) return 'Fair';
  return 'Poor';
}

// GET /v1/referee-ratings/check?matchId=&ratedBy=
router.get(`${BASE}/check`, async (req, res) => {
  try {
    const { matchId, ratedBy } = req.query;
    if (!matchId || !ratedBy) {
      return res.status(400).json({ error: 'matchId and ratedBy are required' });
    }
    const existing = await RefereeRating.findOne({ match: matchId, ratedBy })
      .select('_id stars comment createdAt')
      .lean();
    return res.json({ exists: !!existing, rating: existing || null });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/referee-ratings/referee/:refereeId — aggregate stats visible to all
router.get(`${BASE}/referee/:refereeId`, async (req, res) => {
  try {
    const ratings = await RefereeRating.find({ referee: req.params.refereeId })
      .populate('match', 'matchId scheduledDate homeTeam awayTeam homeScore awayScore tournament')
      .sort({ createdAt: -1 })
      .lean();

    const gamesRated = ratings.length;
    if (gamesRated === 0) {
      return res.json({ averageRating: null, tier: null, gamesRated: 0, ratings: [] });
    }

    const totalStars = ratings.reduce((sum, r) => sum + r.stars, 0);
    const averageRating = Math.round((totalStars / gamesRated) * 10) / 10;
    const tier = computeTier(averageRating);

    return res.json({ averageRating, tier, gamesRated, ratings });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/referee-ratings/match/:matchId — per-game report (internal/admin)
router.get(`${BASE}/match/:matchId`, async (req, res) => {
  try {
    const [ratings, match] = await Promise.all([
      RefereeRating.find({ match: req.params.matchId })
        .populate('referee', 'firstName lastName accountNumber referee_license_level')
        .populate('ratedBy', 'firstName lastName type')
        .lean(),
      Match.findById(req.params.matchId)
        .populate('homeTeam', 'firstName lastName academyName type accountNumber')
        .populate('awayTeam', 'firstName lastName academyName type accountNumber')
        .populate('referee', 'firstName lastName accountNumber referee_license_level')
        .populate('tournament', 'name')
        .select('matchId scheduledDate homeTeam awayTeam homeScore awayScore tournament referee status')
        .lean(),
    ]);

    const gamesRated = ratings.length;
    const averageRating =
      gamesRated > 0
        ? Math.round((ratings.reduce((s, r) => s + r.stars, 0) / gamesRated) * 10) / 10
        : null;
    const tier = averageRating !== null ? computeTier(averageRating) : null;

    return res.json({ match, ratings, averageRating, tier });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/referee-ratings — coach submits a rating
router.post(BASE, async (req, res) => {
  try {
    const { matchId, refereeId, ratedBy, stars, comment } = req.body;
    if (!matchId || !refereeId || !ratedBy || stars == null) {
      return res.status(400).json({ error: 'matchId, refereeId, ratedBy and stars are required' });
    }
    if (stars < 1 || stars > 5) {
      return res.status(400).json({ error: 'stars must be between 1 and 5' });
    }

    const match = await Match.findById(matchId);
    if (!match) return res.status(404).json({ error: 'Match not found' });
    if (match.status !== 'COMPLETED') {
      return res.status(400).json({ error: 'Can only rate referee for completed matches' });
    }
    const isHomeCoach = match.homeCoach?.toString() === ratedBy;
    const isAwayCoach = match.awayCoach?.toString() === ratedBy;
    if (!isHomeCoach && !isAwayCoach) {
      return res.status(403).json({ error: 'Only the match coaches can rate the referee' });
    }

    const rating = await RefereeRating.create({ match: matchId, referee: refereeId, ratedBy, stars, comment });
    return res.status(201).json({ data: rating });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'You have already rated the referee for this match' });
    }
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
