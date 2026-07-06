const express = require('express');
const Match = require('./match.model');
const mongoose = require('mongoose');
const RefereeRating = require('../RefereeRating/referee_rating.model');

function _computeTier(avg) {
  if (avg >= 4.2) return 'Excellent';
  if (avg >= 3.4) return 'Very Good';
  if (avg >= 2.6) return 'Good';
  if (avg >= 1.8) return 'Fair';
  return 'Poor';
}

const router = express.Router();

// GET /v1/stats/player/:id
router.get('/v1/stats/player/:id', async (req, res) => {
  try {
    const playerId = mongoose.Types.ObjectId(req.params.id);
    const matches = await Match.find({ 'playerStats.player': playerId, status: 'COMPLETED' })
      .populate('homeTeam', 'firstName lastName academyName type accountNumber')
      .populate('awayTeam', 'firstName lastName academyName type accountNumber')
      .populate('tournament', 'name')
      .sort({ scheduledDate: -1 });

    const stats = matches.map(m => {
      const playerStat = m.playerStats.find(s => s.player.toString() === req.params.id);
      return {
        matchId: m._id,
        date: m.scheduledDate,
        homeTeam: m.homeTeam,
        awayTeam: m.awayTeam,
        homeScore: m.homeScore,
        awayScore: m.awayScore,
        tournament: m.tournament,
        goals: playerStat?.goals || 0,
        assists: playerStat?.assists || 0,
        yellowCards: playerStat?.yellowCards || 0,
        redCards: playerStat?.redCards || 0,
        minutesPlayed: playerStat?.minutesPlayed || 0,
        position: playerStat?.position || '',
      };
    });

    const totals = {
      appearances: stats.length,
      goals: stats.reduce((a, s) => a + s.goals, 0),
      assists: stats.reduce((a, s) => a + s.assists, 0),
      yellowCards: stats.reduce((a, s) => a + s.yellowCards, 0),
      redCards: stats.reduce((a, s) => a + s.redCards, 0),
      minutesPlayed: stats.reduce((a, s) => a + s.minutesPlayed, 0),
    };

    return res.json({ totals, matches: stats });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/stats/team/:id
router.get('/v1/stats/team/:id', async (req, res) => {
  try {
    const teamId = mongoose.Types.ObjectId(req.params.id);
    const matches = await Match.find({
      $or: [{ homeTeam: teamId }, { awayTeam: teamId }],
      status: 'COMPLETED'
    })
      .populate('homeTeam', 'firstName lastName academyName type accountNumber')
      .populate('awayTeam', 'firstName lastName academyName type accountNumber')
      .populate('tournament', 'name')
      .sort({ scheduledDate: -1 });

    let wins = 0, draws = 0, losses = 0, goalsFor = 0, goalsAgainst = 0;
    matches.forEach(m => {
      const isHome = m.homeTeam._id.toString() === req.params.id;
      const teamScore = isHome ? m.homeScore : m.awayScore;
      const oppScore = isHome ? m.awayScore : m.homeScore;
      goalsFor += teamScore || 0;
      goalsAgainst += oppScore || 0;
      if (teamScore > oppScore) wins++;
      else if (teamScore === oppScore) draws++;
      else losses++;
    });

    return res.json({
      totals: { played: matches.length, wins, draws, losses, goalsFor, goalsAgainst },
      matches
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/stats/coach/:id
router.get('/v1/stats/coach/:id', async (req, res) => {
  try {
    const mongoose = require('mongoose');
    const coachId = mongoose.Types.ObjectId(req.params.id);
    const matches = await Match.find({
      $or: [{ homeCoach: coachId }, { awayCoach: coachId }],
      status: 'COMPLETED'
    })
      .populate('homeTeam', 'firstName lastName academyName type accountNumber')
      .populate('awayTeam', 'firstName lastName academyName type accountNumber')
      .sort({ scheduledDate: -1 });

    let wins = 0, draws = 0, losses = 0;
    matches.forEach(m => {
      const isHome = m.homeCoach?.toString() === req.params.id;
      const teamScore = isHome ? m.homeScore : m.awayScore;
      const oppScore = isHome ? m.awayScore : m.homeScore;
      if (teamScore > oppScore) wins++;
      else if (teamScore === oppScore) draws++;
      else losses++;
    });

    return res.json({ totals: { played: matches.length, wins, draws, losses }, matches });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/stats/referee/:id
router.get('/v1/stats/referee/:id', async (req, res) => {
  try {
    const [matches, ratings] = await Promise.all([
      Match.find({ referee: req.params.id, status: 'COMPLETED' })
        .populate('homeTeam', 'firstName lastName academyName type accountNumber')
        .populate('awayTeam', 'firstName lastName academyName type accountNumber')
        .populate('tournament', 'name')
        .sort({ scheduledDate: -1 }),
      RefereeRating.find({ referee: req.params.id }).lean(),
    ]);

    const gamesRated = ratings.length;
    const averageRating = gamesRated > 0
      ? Math.round((ratings.reduce((s, r) => s + r.stars, 0) / gamesRated) * 10) / 10
      : null;
    const tier = averageRating !== null ? _computeTier(averageRating) : null;

    return res.json({
      totals: { matchesRefereed: matches.length, averageRating, tier, gamesRated },
      matches: matches.map(m => ({
        matchId: m._id,
        date: m.scheduledDate,
        homeTeam: m.homeTeam,
        awayTeam: m.awayTeam,
        homeScore: m.homeScore,
        awayScore: m.awayScore,
        tournament: m.tournament,
      }))
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
