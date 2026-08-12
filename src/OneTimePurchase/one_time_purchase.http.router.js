const express = require('express');
const { getString } = require('@lykmapipo/env');
const OneTimePurchase = require('./one_time_purchase.model');

const API_VERSION = getString('API_VERSION', '1.0.0');
const router = express.Router();
const BASE = `/v${API_VERSION.split('.')[0]}/one-time-purchases`;

// GET /v1/one-time-purchases/catalog — public price + eligibility table.
router.get(`${BASE}/catalog`, (req, res) => {
  return res.status(200).json({
    data: {
      actions: OneTimePurchase.ACTION_TYPES,
      prices: OneTimePurchase.PRICES,
      eligibleTypes: OneTimePurchase.ELIGIBLE_TYPES,
      pendingTtlDays: OneTimePurchase.PENDING_TTL_DAYS,
      useByDays:      OneTimePurchase.USE_BY_DAYS,
    },
  });
});

// GET /v1/one-time-purchases?user=&status=&actionType=
router.get(BASE, async (req, res) => {
  try {
    const filter = {};
    if (req.query.user)       filter.user = req.query.user;
    if (req.query.status)     filter.status = req.query.status;
    if (req.query.actionType) filter.actionType = req.query.actionType;
    const data = await OneTimePurchase.find(filter)
      .populate('user', 'firstName lastName type accountNumber')
      .sort({ createdAt: -1 })
      .lean();
    return res.status(200).json({ data });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/one-time-purchases — create a PENDING purchase.
// Body: { user, actionType, resourceRef?, paymentMethod, transactionId?, notes? }
router.post(BASE, async (req, res) => {
  try {
    const { user, actionType, resourceRef, paymentMethod, transactionId, notes } = req.body;
    if (!user || !actionType) {
      return res.status(400).json({ error: 'user and actionType are required' });
    }
    if (!OneTimePurchase.ACTION_TYPES.includes(actionType)) {
      return res.status(400).json({ error: 'invalid actionType' });
    }
    const price = OneTimePurchase.PRICES[actionType]?.TZS;
    if (price == null) {
      return res.status(400).json({ error: 'no price defined for this action' });
    }
    const purchase = await OneTimePurchase.create({
      user, actionType, resourceRef,
      priceAmount: price, currency: 'TZS',
      paymentMethod: paymentMethod || 'MANUAL',
      transactionId, notes,
      status: 'PENDING',
    });
    return res.status(201).json({ data: purchase });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/one-time-purchases/:id/approve — admin approves after
// verifying the payment landed. Flips status to PAID and resets
// expiresAt to now + USE_BY_DAYS.
router.post(`${BASE}/:id/approve`, async (req, res) => {
  try {
    const { adminUserId } = req.body;
    const purchase = await OneTimePurchase.findById(req.params.id);
    if (!purchase) return res.status(404).json({ error: 'Purchase not found' });
    if (purchase.status !== 'PENDING') {
      return res.status(400).json({ error: `Cannot approve a ${purchase.status} purchase` });
    }
    purchase.status = 'PAID';
    purchase.approvedAt = new Date();
    if (adminUserId) purchase.approvedBy = adminUserId;
    purchase.expiresAt = new Date(
      Date.now() + OneTimePurchase.USE_BY_DAYS * 24 * 60 * 60 * 1000);
    await purchase.save();
    return res.status(200).json({ data: purchase });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/one-time-purchases/:id/refund — admin manual void.
router.post(`${BASE}/:id/refund`, async (req, res) => {
  try {
    const purchase = await OneTimePurchase.findById(req.params.id);
    if (!purchase) return res.status(404).json({ error: 'Purchase not found' });
    if (purchase.status === 'CONSUMED') {
      return res.status(400).json({ error: 'Cannot refund a consumed purchase' });
    }
    purchase.status = 'REFUNDED';
    await purchase.save();
    return res.status(200).json({ data: purchase });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/one-time-purchases/user/:userId/available — quick lookup for
// the mobile client: which unconsumed PAID purchases does this user
// have right now? Powers the "you have 1 Post Clinic slot ready" UI.
router.get(`${BASE}/user/:userId/available`, async (req, res) => {
  try {
    const rows = await OneTimePurchase.find({
      user: req.params.userId, status: 'PAID',
      expiresAt: { $gt: new Date() },
    }).lean();
    return res.status(200).json({ data: rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
