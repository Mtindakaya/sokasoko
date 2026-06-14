const express = require('express');
const { getString } = require('@lykmapipo/env');
const Notification = require('./notification.model');

const API_VERSION = getString('API_VERSION', '1.0.0');
const router = express.Router();
const BASE = `/v${API_VERSION.split('.')[0]}/notifications`;

// GET /v1/notifications/my/:userId
router.get(`${BASE}/my/:userId`, async (req, res) => {
  try {
    const notifications = await Notification.find({ userId: req.params.userId })
      .sort({ createdAt: -1 })
      .limit(50);
    const unreadCount = await Notification.countDocuments({ userId: req.params.userId, read: false });
    return res.status(200).json({ data: notifications, unreadCount });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/notifications/:id/read
router.post(`${BASE}/:id/read`, async (req, res) => {
  try {
    const notification = await Notification.findByIdAndUpdate(
      req.params.id,
      { read: true },
      { new: true }
    );
    if (!notification) return res.status(404).json({ error: 'Not found' });
    return res.status(200).json({ data: notification });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/notifications/mark-all-read/:userId
router.post(`${BASE}/mark-all-read/:userId`, async (req, res) => {
  try {
    await Notification.updateMany({ userId: req.params.userId, read: false }, { read: true });
    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
