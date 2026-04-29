const express = require('express');
const { getString } = require('@lykmapipo/env');
const ScoutCv = require('./scout_cv.model');

const API_VERSION = getString('API_VERSION', '1.0.0');
const router = express.Router();
const prefix = `/v${API_VERSION.split('.')[0]}`;

const populate = [
  { path: 'playerRef', select: 'firstName lastName accountNumber profileImage' },
  { path: 'academyAtIdentification', select: 'academy_name entity_name company_name firstName lastName accountNumber' },
  { path: 'currentClub', select: 'academy_name entity_name company_name firstName lastName accountNumber' },
];

// GET /v1/scout-cv/pending/:playerId — entries pending verification for a player
router.get(`${prefix}/scout-cv/pending/:playerId`, async (req, res) => {
  try {
    const entries = await ScoutCv.find({
      playerRef: req.params.playerId,
      verificationStatus: 'PENDING',
    }).populate({ path: 'scout', select: 'firstName lastName accountNumber profileImage' });
    return res.status(200).json({ data: entries });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/scout-cv/:scoutId — all entries for a scout
router.get(`${prefix}/scout-cv/:scoutId`, async (req, res) => {
  try {
    const entries = await ScoutCv.find({ scout: req.params.scoutId })
      .populate(populate)
      .sort({ yearIdentified: -1, createdAt: -1 });
    return res.status(200).json({ data: entries });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/scout-cv — scout adds a player entry
router.post(`${prefix}/scout-cv`, async (req, res) => {
  try {
    const {
      scoutId, playerRefId, playerName,
      yearIdentified, academyAtIdentificationId,
      academyAtIdentificationName, currentClubId, currentClubName,
    } = req.body;

    if (!scoutId) return res.status(400).json({ error: 'scoutId is required' });
    if (!playerName) return res.status(400).json({ error: 'playerName is required' });
    if (!yearIdentified) return res.status(400).json({ error: 'yearIdentified is required' });

    const status = playerRefId ? 'PENDING' : 'UNVERIFIED';

    const entry = await ScoutCv.create({
      scout: scoutId,
      playerRef: playerRefId || null,
      playerName,
      yearIdentified,
      academyAtIdentification: academyAtIdentificationId || null,
      academyAtIdentificationName: academyAtIdentificationName || null,
      currentClub: currentClubId || null,
      currentClubName: currentClubName || null,
      verificationStatus: status,
    });

    const populated = await ScoutCv.findById(entry._id).populate(populate);
    return res.status(201).json(populated);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// PATCH /v1/scout-cv/:id — scout edits an entry
router.patch(`${prefix}/scout-cv/:id`, async (req, res) => {
  try {
    const {
      playerRefId, playerName, yearIdentified,
      academyAtIdentificationId, academyAtIdentificationName,
      currentClubId, currentClubName,
    } = req.body;

    const update = {};
    if (playerName !== undefined) update.playerName = playerName;
    if (yearIdentified !== undefined) update.yearIdentified = yearIdentified;
    if (academyAtIdentificationName !== undefined) update.academyAtIdentificationName = academyAtIdentificationName;
    if (currentClubName !== undefined) update.currentClubName = currentClubName;
    if (academyAtIdentificationId !== undefined) update.academyAtIdentification = academyAtIdentificationId || null;
    if (currentClubId !== undefined) update.currentClub = currentClubId || null;

    // If a playerRef is being added or changed, reset to PENDING
    if (playerRefId !== undefined) {
      update.playerRef = playerRefId || null;
      update.verificationStatus = playerRefId ? 'PENDING' : 'UNVERIFIED';
    }

    const entry = await ScoutCv.findByIdAndUpdate(req.params.id, update, { new: true })
      .populate(populate);
    if (!entry) return res.status(404).json({ error: 'Entry not found' });
    return res.status(200).json(entry);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /v1/scout-cv/:id — scout deletes an entry
router.delete(`${prefix}/scout-cv/:id`, async (req, res) => {
  try {
    const entry = await ScoutCv.findByIdAndDelete(req.params.id);
    if (!entry) return res.status(404).json({ error: 'Entry not found' });
    return res.status(200).json({ message: 'Deleted' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/scout-cv/:id/respond — player verifies or declines
router.post(`${prefix}/scout-cv/:id/respond`, async (req, res) => {
  try {
    const { action } = req.body; // 'verify' | 'decline'
    if (!['verify', 'decline'].includes(action)) {
      return res.status(400).json({ error: 'action must be verify or decline' });
    }

    if (action === 'decline') {
      // Auto-delete the entry when player declines
      await ScoutCv.findByIdAndDelete(req.params.id);
      return res.status(200).json({ message: 'Entry removed' });
    }

    const entry = await ScoutCv.findByIdAndUpdate(
      req.params.id,
      { verificationStatus: 'VERIFIED' },
      { new: true }
    ).populate(populate);
    if (!entry) return res.status(404).json({ error: 'Entry not found' });
    return res.status(200).json(entry);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
