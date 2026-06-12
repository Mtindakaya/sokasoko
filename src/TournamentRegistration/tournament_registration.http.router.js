const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const TournamentRegistration = require('./tournament_registration.model');
const Tournament = require('../Tournament/tournament.model');

const router = express.Router();

// Multer config for document photos
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'public/uploads/'),
  filename: (req, file, cb) =>
    cb(null, `${Date.now()}-${file.originalname.replace(/\s+/g, '_')}`),
});
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const fileFilter = (req, file, cb) => {
  if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type: ${file.mimetype}. Only images (JPEG, PNG, WebP) and PDF are allowed.`), false);
  }
};
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 }, fileFilter }); // 20MB per doc

const BASE_URL = process.env.BASE_URL || 'https://sokasoko.onrender.com';

// ── POST /v1/tournaments/:id/registrations
// Coach submits a player registration with doc photos
router.post('/v1/tournaments/:id/registrations', upload.array('documents', 10), async (req, res) => {
  const { id: tournamentId } = req.params;
  const { playerId, teamId, submittedBy, jerseyNumber, position, documentLabels } = req.body;

  if (!mongoose.Types.ObjectId.isValid(tournamentId)) {
    return res.status(400).json({ message: 'Invalid tournamentId' });
  }
  if (!playerId || !teamId || !submittedBy) {
    return res.status(400).json({ message: 'playerId, teamId and submittedBy are required' });
  }

  try {
    const tournament = await Tournament.findById(tournamentId);
    if (!tournament) return res.status(404).json({ message: 'Tournament not found' });
    if (!['OPEN', 'ONGOING'].includes(tournament.status)) {
      return res.status(400).json({ message: 'Tournament is not accepting registrations' });
    }

    // Build documents array from uploaded files
    const labels = documentLabels
      ? (Array.isArray(documentLabels) ? documentLabels : [documentLabels])
      : [];
    const documents = (req.files || []).map((file, i) => ({
      url: `${BASE_URL}/uploads/${file.filename}`,
      label: labels[i] || `Document ${i + 1}`,
    }));

    const existing = await TournamentRegistration.findOne({
      tournament: tournamentId,
      player: playerId,
    });

    if (existing) {
      // Update existing registration (re-submit)
      existing.team = teamId;
      existing.submittedBy = submittedBy;
      if (jerseyNumber) existing.jerseyNumber = jerseyNumber;
      if (position) existing.position = position;
      if (documents.length > 0) existing.documents.push(...documents);
      existing.status = 'PENDING';
      existing.rejectionReason = undefined;
      existing.reviewedBy = undefined;
      existing.reviewedAt = undefined;
      await existing.save();
      const populated = await _populate(existing._id);
      return res.status(200).json({ data: populated });
    }

    const reg = await TournamentRegistration.create({
      tournament: tournamentId,
      player: playerId,
      team: teamId,
      submittedBy,
      jerseyNumber,
      position,
      documents,
    });
    const populated = await _populate(reg._id);
    return res.status(201).json({ data: populated });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: 'Player already registered for this tournament' });
    }
    console.error('[TournamentReg] create error:', err.message);
    return res.status(500).json({ message: err.message });
  }
});

// ── GET /v1/tournaments/:id/registrations
// Organizer views all registrations for their tournament
router.get('/v1/tournaments/:id/registrations', async (req, res) => {
  const { id: tournamentId } = req.params;
  const { status, teamId } = req.query;
  if (!mongoose.Types.ObjectId.isValid(tournamentId)) {
    return res.status(400).json({ message: 'Invalid tournamentId' });
  }
  try {
    const filter = { tournament: tournamentId };
    if (status) filter.status = status;
    if (teamId && mongoose.Types.ObjectId.isValid(teamId)) filter.team = teamId;

    const regs = await TournamentRegistration.find(filter)
      .populate('player', 'firstName lastName profileImage position type accountNumber')
      .populate('team', 'firstName lastName academyName profileImage accountNumber')
      .populate('submittedBy', 'firstName lastName')
      .populate('reviewedBy', 'firstName lastName')
      .sort({ createdAt: -1 })
      .lean();
    return res.json({ data: regs });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// ── GET /v1/tournaments/:id/registrations/check?playerId=X
// Check if a specific player is approved for this tournament (used by match result endpoint)
router.get('/v1/tournaments/:id/registrations/check', async (req, res) => {
  const { id: tournamentId } = req.params;
  const { playerId } = req.query;
  if (!playerId) return res.status(400).json({ message: 'playerId required' });
  try {
    const reg = await TournamentRegistration.findOne({
      tournament: tournamentId,
      player: playerId,
      status: 'APPROVED',
    }).lean();
    return res.json({ approved: !!reg });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// ── PATCH /v1/tournaments/:id/registrations/:regId
// Organizer approves or rejects a registration
router.patch('/v1/tournaments/:id/registrations/:regId', async (req, res) => {
  const { regId } = req.params;
  const { status, rejectionReason, reviewedBy } = req.body;
  if (!['APPROVED', 'REJECTED'].includes(status)) {
    return res.status(400).json({ message: 'status must be APPROVED or REJECTED' });
  }
  try {
    const reg = await TournamentRegistration.findById(regId);
    if (!reg) return res.status(404).json({ message: 'Registration not found' });
    reg.status = status;
    reg.rejectionReason = status === 'REJECTED' ? rejectionReason : undefined;
    reg.reviewedBy = reviewedBy || undefined;
    reg.reviewedAt = new Date();
    await reg.save();
    const populated = await _populate(reg._id);
    return res.json({ data: populated });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// ── DELETE /v1/tournaments/:id/registrations/:regId
router.delete('/v1/tournaments/:id/registrations/:regId', async (req, res) => {
  try {
    await TournamentRegistration.findByIdAndDelete(req.params.regId);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

async function _populate(id) {
  return TournamentRegistration.findById(id)
    .populate('player', 'firstName lastName profileImage position type accountNumber')
    .populate('team', 'firstName lastName academyName profileImage accountNumber')
    .populate('submittedBy', 'firstName lastName')
    .populate('reviewedBy', 'firstName lastName')
    .lean();
}

module.exports = router;
