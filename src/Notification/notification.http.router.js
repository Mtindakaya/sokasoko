const express = require('express');
const { getString } = require('@lykmapipo/env');
const Notification = require('./notification.model');
const User = require('../User/user.model');

const API_VERSION = getString('API_VERSION', '1.0.0');
const router = express.Router();
const BASE = `/v${API_VERSION.split('.')[0]}/notifications`;

// Emancipation reminder lazy-check. When the inbox loads for a
// PLAYER/REFEREE who has turned 18 and still has a guardian, create
// (or leave) a pinned reminder unless they have snoozed. On snooze
// expiry the reminder is re-created with a fresh createdAt so it
// re-surfaces at the top.
async function ensureEmancipationReminder(userId) {
  try {
    const user = await User.findById(userId)
      .select('type dob guardian createdBy emancipated ' +
              'emancipationRemindedAt emancipationSnoozedUntil')
      .lean();
    if (!user) return;
    if (!['PLAYER', 'REFEREE'].includes(user.type)) return;
    if (user.emancipated) return;
    const guardianId = user.guardian || user.createdBy;
    if (!guardianId) return;
    if (!user.dob) return;
    const now = new Date();
    const eighteenAgo = new Date(
      now.getFullYear() - 18, now.getMonth(), now.getDate());
    if (new Date(user.dob) > eighteenAgo) return;
    if (user.emancipationSnoozedUntil &&
        new Date(user.emancipationSnoozedUntil) > now) return;

    // Already have an active pinned reminder? Do nothing.
    const existing = await Notification.findOne({
      userId,
      pinned: true,
      'metadata.kind': 'EMANCIPATION_REMINDER',
    }).select('_id').lean();
    if (existing) return;

    await Notification.create({
      userId,
      title: 'Umefikisha miaka 18',
      body: 'Unaweza kuwasha akaunti binafsi (huru na mlezi) wakati wowote. Fungua arifa hii kwa chaguzi.',
      titleKey: 'notif.emancipation.reminder_title',
      bodyKey: 'notif.emancipation.reminder_body',
      params: {},
      type: 'SYSTEM',
      pinned: true,
      metadata: { kind: 'EMANCIPATION_REMINDER' },
    });
    await User.updateOne(
      { _id: userId },
      { $set: { emancipationRemindedAt: now,
                emancipationSnoozedUntil: null } });
  } catch (err) {
    console.error('[emancipation.reminder] failed for', String(userId),
                  '—', err.message);
  }
}

// GET /v1/notifications/my/:userId
router.get(`${BASE}/my/:userId`, async (req, res) => {
  try {
    await ensureEmancipationReminder(req.params.userId);
    const [notifications, unreadCount] = await Promise.all([
      Notification.find({ userId: req.params.userId })
        .select('title body titleKey bodyKey params type read pinned metadata createdAt')
        .sort({ pinned: -1, createdAt: -1 })
        .limit(50)
        .lean(),
      Notification.countDocuments({ userId: req.params.userId, read: false }),
    ]);
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
    // Pinned notifications are excluded from mark-all-read so the
    // emancipation reminder (and any future pinned prompts) stays
    // discoverable until the user acts on it.
    await Notification.updateMany(
      { userId: req.params.userId, read: false, pinned: { $ne: true } },
      { read: true });
    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
