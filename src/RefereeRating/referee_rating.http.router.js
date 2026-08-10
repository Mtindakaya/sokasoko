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

// POST /v1/referee-ratings/seed — insert a test rating directly (demo/dev only)
router.post(`${BASE}/seed`, async (req, res) => {
  try {
    const { refereeId, stars, comment } = req.body;
    if (!refereeId || !stars) return res.status(400).json({ error: 'refereeId and stars required' });
    const mongoose = require('mongoose');
    const fakeMatchId = new mongoose.Types.ObjectId();
    const fakeRatedBy = new mongoose.Types.ObjectId();
    const rating = await RefereeRating.create({
      match: fakeMatchId, referee: refereeId, ratedBy: fakeRatedBy, stars, comment,
    });
    return res.status(201).json({ data: rating });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/referee-ratings/check?matchId=&ratedBy=
// GET /v1/referee-ratings/check?matchId=&ratedBy=[&referee=]
// Returns { ratings: [...] } — every rating this user has already submitted
// on this match, one per officiated referee. Optional `referee` filter
// narrows to a single official (preserves the older single-target semantics).
router.get(`${BASE}/check`, async (req, res) => {
  try {
    const { matchId, ratedBy, referee } = req.query;
    if (!matchId || !ratedBy) {
      return res.status(400).json({ error: 'matchId and ratedBy are required' });
    }
    const filter = { match: matchId, ratedBy };
    if (referee) filter.referee = referee;
    const rows = await RefereeRating.find(filter)
      .select('_id referee stars comment createdAt')
      .lean();
    // Back-compat: keep the singular `rating` for callers that pass `referee`.
    return res.json({
      ratings: rows,
      rating: referee ? (rows[0] || null) : null,
      exists: rows.length > 0,
    });
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
    // Eligibility: the caller must be either a registered coach on the
    // match OR the team-owner user id (homeTeam / awayTeam). Team owners
    // cover the common case where a match never had its homeCoach /
    // awayCoach populated but a coach-role user still wants to rate.
    const isHomeCoach = match.homeCoach?.toString() === ratedBy;
    const isAwayCoach = match.awayCoach?.toString() === ratedBy;
    const isHomeTeam  = match.homeTeam?.toString() === ratedBy;
    const isAwayTeam  = match.awayTeam?.toString() === ratedBy;
    if (!isHomeCoach && !isAwayCoach && !isHomeTeam && !isAwayTeam) {
      return res.status(403).json({ error: 'Only the match coaches or team owners can rate the referee crew' });
    }

    // The refereeId must be one of the three officiating slots on the match —
    // prevents a coach from rating an unrelated user.
    const officiatingSlots = [
      match.referee?.toString(),
      match.assistantReferee1?.toString(),
      match.assistantReferee2?.toString(),
    ].filter(Boolean);
    if (!officiatingSlots.includes(refereeId)) {
      return res.status(400).json({ error: 'refereeId was not officiating this match' });
    }

    const rating = await RefereeRating.create({ match: matchId, referee: refereeId, ratedBy, stars, comment });
    return res.status(201).json({ data: rating });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'You have already rated this official for this match' });
    }
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
