const express = require('express');
const User = require('./user.model');
const Academy = require('../Academy/academy.model');

const router = express.Router();

// POST /v1/users/:id/link-coach
router.post('/v1/users/:id/link-coach', async (req, res) => {
  try {
    const { coachId, requestedBy } = req.body;
    const academy = await User.findById(req.params.id);
    if (!academy) return res.status(404).json({ error: 'Academy not found' });
    if (academy.type !== 'ACADEMY') return res.status(400).json({ error: 'User is not an academy' });

    const coach = await User.findById(coachId);
    if (!coach) return res.status(404).json({ error: 'Coach not found' });
    if (coach.type !== 'COACH') return res.status(400).json({ error: 'User is not a coach' });

    coach.linkedAcademy = academy._id;
    await coach.save();

    return res.status(200).json({ message: 'Coach linked successfully', coach });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/users/:id/link-owner
router.post('/v1/users/:id/link-owner', async (req, res) => {
  try {
    const { userId } = req.body;
    const academy = await User.findByIdAndUpdate(req.params.id, { owner: userId }, { new: true });
    if (!academy) return res.status(404).json({ error: 'Academy not found' });
    return res.status(200).json({ data: academy });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/users/:id/link-secretary
router.post('/v1/users/:id/link-secretary', async (req, res) => {
  try {
    const { userId } = req.body;
    const academy = await User.findByIdAndUpdate(req.params.id, { secretary: userId }, { new: true });
    if (!academy) return res.status(404).json({ error: 'Academy not found' });
    return res.status(200).json({ data: academy });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/users/:id/coaches
router.get('/v1/users/:id/coaches', async (req, res) => {
  try {
    const coaches = await User.find({ linkedAcademy: req.params.id, type: 'COACH' });
    return res.status(200).json({ data: coaches });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /v1/users/:id/unlink-school
router.delete('/v1/users/:id/unlink-school', async (req, res) => {
  try {
    const reason = (req.body && req.body.reason) ? req.body.reason.trim() : '';
    const player = await User.findById(req.params.id).lean();
    if (!player) return res.status(404).json({ error: 'Player not found' });

    const updated = await User.findByIdAndUpdate(
      req.params.id,
      { $set: { school: null, school_class: null, school_jersey_number: null } },
      { new: true }
    );

    if (reason) {
      console.log(`[LEAVE-SCHOOL] player=${req.params.id} school=${player.school} reason="${reason}"`);
    }

    return res.status(200).json(updated);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/users/:id/leave-academy
router.post('/v1/users/:id/leave-academy', async (req, res) => {
  try {
    const { enrollmentId, reason } = req.body || {};
    if (!enrollmentId) return res.status(400).json({ error: 'enrollmentId is required' });

    const enrollment = await Academy.findById(enrollmentId);
    if (!enrollment) return res.status(404).json({ error: 'Enrollment not found' });

    const academyId = enrollment.addedBy;
    await Academy.findByIdAndDelete(enrollmentId);

    const updated = await User.findByIdAndUpdate(
      req.params.id,
      { $set: { academy: null } },
      { new: true }
    );

    if (reason) {
      console.log(`[LEAVE-ACADEMY] player=${req.params.id} academy=${academyId} reason="${reason}"`);
    }

    return res.status(200).json(updated);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/users/:id/link-school
router.post('/v1/users/:id/link-school', async (req, res) => {
  try {
    const player = await User.findById(req.params.id).lean();
    if (!player) return res.status(404).json({ error: 'Player not found' });

    if (player.school && player.school.toString() !== req.body.schoolId) {
      return res.status(409).json({ error: 'Player is already enrolled in another school' });
    }

    const updateData = { school: req.body.schoolId };
    if (req.body.school_class) updateData.school_class = req.body.school_class;
    if (req.body.school_jersey_number) updateData.school_jersey_number = req.body.school_jersey_number;

    const updated = await User.findByIdAndUpdate(
      req.params.id,
      { $set: updateData },
      { new: true }
    );
    return res.status(200).json(updated);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/users/:id/school-players
router.get('/v1/users/:id/school-players', async (req, res) => {
  try {
    const players = await User.find({ school: req.params.id, type: 'PLAYER' })
      .limit(500)
      .lean();
    return res.status(200).json({ data: players });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
