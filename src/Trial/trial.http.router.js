const express = require('express');
const { getString } = require('@lykmapipo/env');
const Trial = require('./trial.model');
const TrialRegistration = require('./trial_registration.model');

const API_VERSION = getString('API_VERSION', '1.0.0');
const router = express.Router();
const BASE = `/v${API_VERSION.split('.')[0]}/trials`;

// GET /v1/trials — list with filters and pagination
router.get(BASE, async (req, res) => {
  try {
    const { page = 1, limit = 20, status, gender, ageGroup, organizer } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (gender) filter.gender = gender;
    if (ageGroup) filter.ageGroup = ageGroup;
    if (organizer) filter.organizer = organizer;

    const trials = await Trial.find(filter)
      .populate('organizer', 'firstName lastName type academyName')
      .sort({ date: 1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit));

    const total = await Trial.countDocuments(filter);
    return res.status(200).json({
      data: trials,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/trials/my/:userId — trials organised by a specific user
// NOTE: must be defined BEFORE /:id to avoid route collision
router.get(`${BASE}/my/:userId`, async (req, res) => {
  try {
    const trials = await Trial.find({ organizer: req.params.userId })
      .sort({ createdAt: -1 })
      .limit(50);
    return res.status(200).json({ data: trials });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/trials/registered/:userId — registrations for a player
// NOTE: must be defined BEFORE /:id to avoid route collision
router.get(`${BASE}/registered/:userId`, async (req, res) => {
  try {
    const registrations = await TrialRegistration.find({ playerId: req.params.userId })
      .populate('trialId');
    return res.status(200).json({ data: registrations });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/trials/:id — single trial with registration count and optional isRegistered flag
router.get(`${BASE}/:id`, async (req, res) => {
  try {
    const trial = await Trial.findById(req.params.id)
      .populate('organizer', 'firstName lastName type academyName');
    if (!trial) return res.status(404).json({ error: 'Trial not found' });

    const registrationCount = await TrialRegistration.countDocuments({ trialId: req.params.id });

    const response = { data: trial, registrationCount };

    if (req.query.playerId) {
      const existing = await TrialRegistration.findOne({
        trialId: req.params.id,
        playerId: req.query.playerId,
      });
      response.isRegistered = !!existing;
    }

    return res.status(200).json(response);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/trials — create a new trial
router.post(BASE, async (req, res) => {
  try {
    const { title, organizer, date, location, gender } = req.body;
    if (!title || !organizer || !date || !location || !gender) {
      return res.status(400).json({ error: 'title, organizer, date, location and gender are required' });
    }
    const trial = await Trial.create(req.body);
    return res.status(201).json({ data: trial });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// PATCH /v1/trials/:id — update trial fields
router.patch(`${BASE}/:id`, async (req, res) => {
  try {
    const trial = await Trial.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!trial) return res.status(404).json({ error: 'Trial not found' });
    return res.status(200).json({ data: trial });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /v1/trials/:id — soft delete: set status to Cancelled
router.delete(`${BASE}/:id`, async (req, res) => {
  try {
    const trial = await Trial.findByIdAndUpdate(
      req.params.id,
      { status: 'Cancelled' },
      { new: true }
    );
    if (!trial) return res.status(404).json({ error: 'Trial not found' });
    return res.status(200).json({ data: trial });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/trials/:id/register — register a player for a trial
router.post(`${BASE}/:id/register`, async (req, res) => {
  try {
    const { playerId } = req.body;
    if (!playerId) return res.status(400).json({ error: 'playerId is required' });

    const trial = await Trial.findById(req.params.id);
    if (!trial) return res.status(404).json({ error: 'Trial not found' });
    if (trial.status !== 'Open') return res.status(400).json({ error: 'Trial is not open for registration' });

    const existing = await TrialRegistration.findOne({ trialId: req.params.id, playerId });
    if (existing) return res.status(400).json({ error: 'Player is already registered for this trial' });

    if (trial.maxParticipants) {
      const count = await TrialRegistration.countDocuments({ trialId: req.params.id });
      if (count >= trial.maxParticipants) {
        return res.status(400).json({ error: 'Trial has reached maximum participants' });
      }
    }

    const registration = await TrialRegistration.create({ trialId: req.params.id, playerId });
    return res.status(201).json({ data: registration });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /v1/trials/:id/register — withdraw a player from a trial
router.delete(`${BASE}/:id/register`, async (req, res) => {
  try {
    const playerId = req.body.playerId || req.query.playerId;
    if (!playerId) return res.status(400).json({ error: 'playerId is required' });

    const registration = await TrialRegistration.findOneAndDelete({
      trialId: req.params.id,
      playerId,
    });
    if (!registration) return res.status(404).json({ error: 'Registration not found' });
    return res.status(200).json({ message: 'Withdrawn' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/trials/:id/registrations — list all registrations for a trial
router.get(`${BASE}/:id/registrations`, async (req, res) => {
  try {
    const registrations = await TrialRegistration.find({ trialId: req.params.id })
      .populate('playerId', 'firstName lastName profileImage position type accountNumber');
    const total = registrations.length;
    return res.status(200).json({ data: registrations, total });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// PATCH /v1/trials/:id/registrations/:regId — update registration status
router.patch(`${BASE}/:id/registrations/:regId`, async (req, res) => {
  try {
    const registration = await TrialRegistration.findByIdAndUpdate(
      req.params.regId,
      { status: req.body.status },
      { new: true }
    );
    if (!registration) return res.status(404).json({ error: 'Registration not found' });
    return res.status(200).json({ data: registration });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
