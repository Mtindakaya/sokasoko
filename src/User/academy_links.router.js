const express = require('express');
const User = require('./user.model');

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

module.exports = router;
