const express = require('express');
const { getString } = require('@lykmapipo/env');
const _ = require('lodash');
const Tournament = require('./tournament.model');

const API_VERSION = getString('API_VERSION', '1.0.0');
const router = express.Router();
const BASE = `/v${API_VERSION.split('.')[0]}/tournaments`;

// GET /v1/tournaments
router.get(BASE, async (req, res) => {
  try {
    const { page = 1, limit = 20, status, type, organizer } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (type) filter.type = type;
    if (organizer) filter.organizer = organizer;

    const tournaments = await Tournament.find(filter)
      .populate('organizer', 'firstName lastName type academyName companyName')
      .populate('venue', 'name region district')
      .populate('teams', 'firstName lastName academyName type accountNumber')
      .sort({ startDate: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Tournament.countDocuments(filter);
    return res.status(200).json({ data: tournaments, total, page: parseInt(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/tournaments/:id
router.get(`${BASE}/:id`, async (req, res) => {
  try {
    const tournament = await Tournament.findById(req.params.id)
      .populate('organizer', 'firstName lastName type academyName companyName')
      .populate('venue', 'name region district')
      .populate('teams', 'firstName lastName academyName type accountNumber profileImage');
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
    return res.status(200).json({ data: tournament });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/tournaments
router.post(BASE, async (req, res) => {
  try {
    const { name, type, organizer, startDate, endDate, region, venue, maxTeams, ageGroup, description, prize, rules } = req.body;
    if (!name || !type || !organizer || !startDate || !endDate) {
      return res.status(400).json({ error: 'name, type, organizer, startDate and endDate are required' });
    }
    const tournament = await Tournament.create({ name, type, organizer, startDate, endDate, region, venue, maxTeams, ageGroup, description, prize, rules });
    return res.status(201).json({ data: tournament });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/tournaments/:id/teams — add a team to tournament
router.post(`${BASE}/:id/teams`, async (req, res) => {
  try {
    const { teamId } = req.body;
    const tournament = await Tournament.findById(req.params.id);
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
    if (tournament.teams.includes(teamId)) return res.status(400).json({ error: 'Team already in tournament' });
    if (tournament.teams.length >= tournament.maxTeams) return res.status(400).json({ error: 'Tournament is full' });
    tournament.teams.push(teamId);
    await tournament.save();
    return res.status(200).json({ data: tournament });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /v1/tournaments/:id/teams/:teamId — remove a team
router.delete(`${BASE}/:id/teams/:teamId`, async (req, res) => {
  try {
    const tournament = await Tournament.findById(req.params.id);
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
    tournament.teams = tournament.teams.filter(t => t.toString() !== req.params.teamId);
    await tournament.save();
    return res.status(200).json({ data: tournament });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// PATCH /v1/tournaments/:id
router.patch(`${BASE}/:id`, async (req, res) => {
  try {
    const tournament = await Tournament.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
    return res.status(200).json({ data: tournament });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /v1/tournaments/:id
router.delete(`${BASE}/:id`, async (req, res) => {
  try {
    const tournament = await Tournament.findByIdAndUpdate(req.params.id, { status: 'CANCELLED' }, { new: true });
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
    return res.status(200).json({ data: tournament });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
