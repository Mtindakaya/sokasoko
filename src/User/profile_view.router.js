const express = require('express');
const mongoose = require('mongoose');
const ProfileView = require('./profile_view.model');

const router = express.Router();

// GET /v1/users/:id/views
router.get('/v1/users/:id/views', async (req, res) => {
  try {
    const { id } = req.params;
    const objId = mongoose.Types.ObjectId(id);
    const total = await ProfileView.countDocuments({ profile: objId });
    const byType = await ProfileView.aggregate([
      { $match: { profile: objId } },
      { $group: { _id: '$viewerType', count: { $sum: 1 } } }
    ]);
    return res.json({ total, byType });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
