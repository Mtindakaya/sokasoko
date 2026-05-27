const express = require('express');
const { getString } = require('@lykmapipo/env');
const OpenTournament = require('./open_tournament.model');

const API_VERSION = getString('API_VERSION', '1.0.0');
const router = express.Router();
const BASE = `/v${API_VERSION.split('.')[0]}/open-tournaments`;

// GET /v1/open-tournaments
router.get(BASE, async (req, res) => {
  try {
    const { page = 1, limit = 20, status, organizer } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (organizer) filter.organizer = organizer;

    const [tournaments, total] = await Promise.all([
      OpenTournament.find(filter)
        .populate('organizer', 'firstName lastName accountNumber type profileImage')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(parseInt(limit))
        .lean(),
      OpenTournament.countDocuments(filter),
    ]);
    return res.status(200).json({ data: tournaments, total, page: parseInt(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/open-tournaments/:id
router.get(`${BASE}/:id`, async (req, res) => {
  try {
    const tournament = await OpenTournament.findById(req.params.id)
      .populate('organizer', 'firstName lastName accountNumber type profileImage')
      .lean();
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
    return res.status(200).json({ data: tournament });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/open-tournaments
router.post(BASE, async (req, res) => {
  try {
    const { name, type, organizer, description, startDate, endDate, location, prize, rules, photo, teams } = req.body;
    if (!name || !type || !organizer) {
      return res.status(400).json({ error: 'name, type and organizer are required' });
    }
    const tournament = await OpenTournament.create({ name, type, organizer, description, startDate, endDate, location, prize, rules, photo, teams });
    return res.status(201).json({ data: tournament });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// PATCH /v1/open-tournaments/:id — update tournament details
router.patch(`${BASE}/:id`, async (req, res) => {
  try {
    const allowed = ['name', 'type', 'status', 'description', 'startDate', 'endDate', 'location', 'prize', 'rules', 'photo'];
    const updates = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
    const tournament = await OpenTournament.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
    return res.status(200).json({ data: tournament });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /v1/open-tournaments/:id
router.delete(`${BASE}/:id`, async (req, res) => {
  try {
    const tournament = await OpenTournament.findByIdAndDelete(req.params.id);
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
    return res.status(200).json({ data: tournament });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// --- Team management ---

// POST /v1/open-tournaments/:id/teams — add a team
router.post(`${BASE}/:id/teams`, async (req, res) => {
  try {
    const { name, captain, contact } = req.body;
    if (!name) return res.status(400).json({ error: 'Team name is required' });
    const tournament = await OpenTournament.findById(req.params.id);
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
    tournament.teams.push({ name, captain, contact });
    await tournament.save();
    return res.status(200).json({ data: tournament });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /v1/open-tournaments/:id/teams/:teamIndex — remove a team by array index
router.delete(`${BASE}/:id/teams/:teamIndex`, async (req, res) => {
  try {
    const tournament = await OpenTournament.findById(req.params.id);
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
    const idx = parseInt(req.params.teamIndex);
    if (isNaN(idx) || idx < 0 || idx >= tournament.teams.length) {
      return res.status(400).json({ error: 'Invalid team index' });
    }
    tournament.teams.splice(idx, 1);
    await tournament.save();
    return res.status(200).json({ data: tournament });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// --- Fixture management ---

// POST /v1/open-tournaments/:id/fixtures — add a fixture
router.post(`${BASE}/:id/fixtures`, async (req, res) => {
  try {
    const { homeTeam, awayTeam, scheduledDate, venue, round, notes } = req.body;
    if (!homeTeam || !awayTeam) return res.status(400).json({ error: 'homeTeam and awayTeam are required' });
    if (homeTeam === awayTeam) return res.status(400).json({ error: 'Home and away team cannot be the same' });
    const tournament = await OpenTournament.findById(req.params.id);
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
    tournament.fixtures.push({ homeTeam, awayTeam, scheduledDate, venue, round, notes });
    await tournament.save();
    return res.status(200).json({ data: tournament });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// PATCH /v1/open-tournaments/:id/fixtures/:fixtureId — update fixture details
router.patch(`${BASE}/:id/fixtures/:fixtureId`, async (req, res) => {
  try {
    const tournament = await OpenTournament.findById(req.params.id);
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
    const fixture = tournament.fixtures.id(req.params.fixtureId);
    if (!fixture) return res.status(404).json({ error: 'Fixture not found' });
    const allowed = ['homeTeam', 'awayTeam', 'scheduledDate', 'venue', 'round', 'notes', 'status'];
    allowed.forEach(k => { if (req.body[k] !== undefined) fixture[k] = req.body[k]; });
    await tournament.save();
    return res.status(200).json({ data: tournament });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /v1/open-tournaments/:id/fixtures/:fixtureId
router.delete(`${BASE}/:id/fixtures/:fixtureId`, async (req, res) => {
  try {
    const tournament = await OpenTournament.findById(req.params.id);
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
    const fixture = tournament.fixtures.id(req.params.fixtureId);
    if (!fixture) return res.status(404).json({ error: 'Fixture not found' });
    fixture.deleteOne();
    await tournament.save();
    return res.status(200).json({ data: tournament });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/open-tournaments/:id/fixtures/:fixtureId/result — enter scores + goalscorers
router.post(`${BASE}/:id/fixtures/:fixtureId/result`, async (req, res) => {
  try {
    const { organizerId, homeScore, awayScore, homeGoalscorers, awayGoalscorers } = req.body;
    if (!organizerId) return res.status(400).json({ error: 'organizerId is required' });

    const tournament = await OpenTournament.findById(req.params.id);
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
    if (tournament.organizer.toString() !== organizerId) {
      return res.status(403).json({ error: 'Only the tournament organizer can enter results' });
    }

    const fixture = tournament.fixtures.id(req.params.fixtureId);
    if (!fixture) return res.status(404).json({ error: 'Fixture not found' });
    if (fixture.status === 'COMPLETED') return res.status(400).json({ error: 'Fixture already completed' });

    fixture.homeScore = homeScore ?? fixture.homeScore;
    fixture.awayScore = awayScore ?? fixture.awayScore;
    if (homeGoalscorers !== undefined) fixture.homeGoalscorers = homeGoalscorers;
    if (awayGoalscorers !== undefined) fixture.awayGoalscorers = awayGoalscorers;
    fixture.status = 'COMPLETED';

    await tournament.save();
    return res.status(200).json({ data: tournament });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
