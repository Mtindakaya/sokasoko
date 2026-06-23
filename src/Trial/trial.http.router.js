const express = require('express');
const { getString } = require('@lykmapipo/env');
const Trial = require('./trial.model');
const TrialRegistration = require('./trial_registration.model');
const { uploadFor } = require('../Utils/uploader');

const API_VERSION = getString('API_VERSION', '1.0.0');
const router = express.Router();
const BASE = `/v${API_VERSION.split('.')[0]}/trials`;

const AGE_GROUP_MAX = { U12: 12, U14: 14, U16: 16, U17: 17, U18: 18, U20: 20, U23: 23 };

// GET /v1/trials
router.get(BASE, async (req, res) => {
  try {
    const { page = 1, limit = 20, status, gender, ageGroup, organizer, trialFor } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (gender) filter.gender = gender;
    if (ageGroup) filter.ageGroups = ageGroup; // array contains match
    if (organizer) filter.organizer = organizer;
    if (trialFor) filter.trialFor = trialFor;

    const trials = await Trial.find(filter)
      .populate('organizer', 'firstName lastName type academyName profileImage')
      .sort({ startDate: 1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit));

    const total = await Trial.countDocuments(filter);
    return res.status(200).json({ data: trials, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/trials/my/:userId — NOTE: before /:id
router.get(`${BASE}/my/:userId`, async (req, res) => {
  try {
    const trials = await Trial.find({ organizer: req.params.userId })
      .populate('organizer', 'firstName lastName type academyName profileImage')
      .sort({ createdAt: -1 })
      .limit(50);
    return res.status(200).json({ data: trials });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/trials/registered/:userId — NOTE: before /:id
router.get(`${BASE}/registered/:userId`, async (req, res) => {
  try {
    const registrations = await TrialRegistration.find({ playerId: req.params.userId })
      .populate('trialId');
    return res.status(200).json({ data: registrations });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/trials/:id
router.get(`${BASE}/:id`, async (req, res) => {
  try {
    const trial = await Trial.findById(req.params.id)
      .populate('organizer', 'firstName lastName type academyName profileImage accountNumber');
    if (!trial) return res.status(404).json({ error: 'Trial not found' });

    const registrationCount = await TrialRegistration.countDocuments({ trialId: req.params.id });
    const response = { data: trial, registrationCount };

    if (req.query.playerId) {
      const existing = await TrialRegistration.findOne({ trialId: req.params.id, playerId: req.query.playerId });
      response.isRegistered = !!existing;
      if (existing) response.registration = existing;
    }
    if (req.query.academyId) {
      const existing = await TrialRegistration.findOne({ trialId: req.params.id, academyId: req.query.academyId });
      response.isAcademyRegistered = !!existing;
    }

    return res.status(200).json(response);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/trials
router.post(BASE, async (req, res) => {
  try {
    const { title, organizer, startDate, location, gender } = req.body;
    if (!title || !organizer || !startDate || !location || !gender) {
      return res.status(400).json({ error: 'title, organizer, startDate, location and gender are required' });
    }
    const trial = await Trial.create(req.body);
    const populated = await Trial.findById(trial._id)
      .populate('organizer', 'firstName lastName type academyName profileImage accountNumber');
    return res.status(201).json({ data: populated });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// PATCH /v1/trials/:id
router.patch(`${BASE}/:id`, async (req, res) => {
  try {
    const trial = await Trial.findByIdAndUpdate(req.params.id, req.body, { new: true })
      .populate('organizer', 'firstName lastName type academyName profileImage accountNumber');
    if (!trial) return res.status(404).json({ error: 'Trial not found' });
    return res.status(200).json({ data: trial });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /v1/trials/:id — soft delete
router.delete(`${BASE}/:id`, async (req, res) => {
  try {
    const trial = await Trial.findByIdAndUpdate(req.params.id, { status: 'Cancelled' }, { new: true });
    if (!trial) return res.status(404).json({ error: 'Trial not found' });
    return res.status(200).json({ data: trial });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/trials/:id/register — player or academy registration
router.post(`${BASE}/:id/register`, async (req, res) => {
  try {
    const { playerId, academyId, registrantType = 'PLAYER', selectedAgeGroup } = req.body;

    const trial = await Trial.findById(req.params.id);
    if (!trial) return res.status(404).json({ error: 'Trial not found' });
    if (trial.status !== 'Open') return res.status(400).json({ error: 'Trial is not open for registration' });

    // Academy registration
    if (registrantType === 'ACADEMY') {
      if (!academyId) return res.status(400).json({ error: 'academyId is required for academy registration' });
      const existing = await TrialRegistration.findOne({ trialId: req.params.id, academyId });
      if (existing) return res.status(400).json({ error: 'Academy is already registered for this trial' });

      const registration = await TrialRegistration.create({
        trialId: req.params.id,
        academyId,
        registrantType: 'ACADEMY',
      });
      return res.status(201).json({
        data: registration,
        message: 'Academy registered. Individual players in this academy can now submit their documents.',
      });
    }

    // Player registration
    if (!playerId) return res.status(400).json({ error: 'playerId is required' });

    const existing = await TrialRegistration.findOne({ trialId: req.params.id, playerId });
    if (existing) return res.status(400).json({ error: 'Player is already registered for this trial' });

    if (trial.maxParticipants) {
      const count = await TrialRegistration.countDocuments({ trialId: req.params.id });
      if (count >= trial.maxParticipants) {
        return res.status(400).json({ error: 'Trial has reached maximum participants' });
      }
    }

    // Age group validation
    if (selectedAgeGroup && selectedAgeGroup !== 'Open') {
      const User = require('../User/user.model');
      const player = await User.findById(playerId).select('dob').lean();
      if (player && player.dob) {
        const ageMs = Date.now() - new Date(player.dob).getTime();
        const age = Math.floor(ageMs / (365.25 * 24 * 60 * 60 * 1000));
        const maxAge = AGE_GROUP_MAX[selectedAgeGroup];
        if (maxAge !== undefined && age > maxAge) {
          return res.status(400).json({
            error: `You are ${age} years old and cannot register for ${selectedAgeGroup} (max age: ${maxAge}).`,
          });
        }
      }
    }

    // Validate selectedAgeGroup is in trial's ageGroups
    if (selectedAgeGroup && trial.ageGroups.length > 0 && !trial.ageGroups.includes(selectedAgeGroup)) {
      return res.status(400).json({ error: `${selectedAgeGroup} is not an available age group for this trial` });
    }

    const registration = await TrialRegistration.create({
      trialId: req.params.id,
      playerId,
      registrantType: 'PLAYER',
      selectedAgeGroup: selectedAgeGroup || undefined,
    });
    return res.status(201).json({ data: registration });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /v1/trials/:id/register — withdraw
router.delete(`${BASE}/:id/register`, async (req, res) => {
  try {
    const playerId = req.body.playerId || req.query.playerId;
    const academyId = req.body.academyId || req.query.academyId;
    if (!playerId && !academyId) return res.status(400).json({ error: 'playerId or academyId is required' });

    const query = { trialId: req.params.id };
    if (playerId) query.playerId = playerId;
    if (academyId) query.academyId = academyId;

    const registration = await TrialRegistration.findOneAndDelete(query);
    if (!registration) return res.status(404).json({ error: 'Registration not found' });
    return res.status(200).json({ message: 'Withdrawn' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/trials/:id/registrations
router.get(`${BASE}/:id/registrations`, async (req, res) => {
  try {
    const registrations = await TrialRegistration.find({ trialId: req.params.id })
      .populate('playerId', 'firstName lastName profileImage position type accountNumber sId')
      .populate('academyId', 'firstName lastName profileImage type accountNumber academyName sId');
    return res.status(200).json({ data: registrations, total: registrations.length });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// PATCH /v1/trials/:id/registrations/:regId — update status
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

// PATCH /v1/trials/:id/registrations/:regId/docs — upload DOB doc + passport photo
router.patch(`${BASE}/:id/registrations/:regId/docs`, uploadFor(), async (req, res) => {
  try {
    const updates = {};
    if (req.body.dobDocument) updates.dobDocument = req.body.dobDocument;
    if (req.body.passportPhoto) updates.passportPhoto = req.body.passportPhoto;
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'No files uploaded' });

    const registration = await TrialRegistration.findByIdAndUpdate(req.params.regId, updates, { new: true });
    if (!registration) return res.status(404).json({ error: 'Registration not found' });
    return res.status(200).json({ data: registration });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
