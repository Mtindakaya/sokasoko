const express = require('express');
const { getString } = require('@lykmapipo/env');
const _ = require('lodash');
const { Subscription, PRICES } = require('./subscription.model');

const API_VERSION = getString('API_VERSION', '1.0.0');
const router = express.Router();
const BASE = `/v${API_VERSION.split('.')[0]}/subscriptions`;

// GET /v1/subscriptions/prices
// Returns the price table for the frontend/CMS
router.get(`${BASE}/prices`, (req, res) => {
  return res.status(200).json({ data: PRICES });
});

// GET /v1/subscriptions
// List all subscriptions (admin)
router.get(BASE, async (req, res) => {
  try {
    const { status, userType, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (userType) filter.userType = userType;

    const subscriptions = await Subscription.find(filter)
      .populate('user', 'firstName lastName phone accountNumber type')
      .populate('activatedBy', 'firstName lastName')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Subscription.countDocuments(filter);

    return res.status(200).json({
      data: subscriptions,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/subscriptions/user/:userId
// Get subscription status for a specific user
router.get(`${BASE}/user/:userId`, async (req, res) => {
  try {
    const { userId } = req.params;
    const subscription = await Subscription.getActiveSubscription(userId);
    const isSubscribed = !!subscription;

    return res.status(200).json({
      isSubscribed,
      subscription: subscription || null,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/subscriptions
// Create a new subscription (admin or user)
router.post(BASE, async (req, res) => {
  try {
    const { user, userType, plan, currency, paymentMethod, notes, transactionId } = req.body;

    if (!user || !userType || !plan) {
      return res.status(400).json({ error: 'user, userType and plan are required' });
    }

    // Validate plan is allowed for userType
    if (userType === 'PLAYER' && plan === 'BIANNUAL') {
      return res.status(400).json({ error: 'BIANNUAL plan is not available for players' });
    }
    if (userType === 'SCOUT' && plan === 'MONTHLY') {
      return res.status(400).json({ error: 'MONTHLY plan is not available for scouts' });
    }

    // Get amount from price table
    const selectedCurrency = currency || 'TZS';
    const amount = PRICES[userType]?.[plan]?.[selectedCurrency];
    if (!amount) {
      return res.status(400).json({ error: 'Invalid plan/currency combination' });
    }

    const subscription = await Subscription.create({
      user,
      userType,
      plan,
      currency: selectedCurrency,
      amount,
      paymentMethod: paymentMethod || 'MANUAL',
      notes,
      transactionId,
      status: 'PENDING',
    });

    return res.status(201).json({ data: subscription });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/subscriptions/:id/activate
// Admin activates a subscription manually
router.post(`${BASE}/:id/activate`, async (req, res) => {
  try {
    const { id } = req.params;
    const adminUserId = _.get(req.body, 'adminUserId');

    const subscription = await Subscription.findById(id);
    if (!subscription) {
      return res.status(404).json({ error: 'Subscription not found' });
    }

    await subscription.activate(adminUserId);

    return res.status(200).json({ data: subscription });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/subscriptions/:id/cancel
// Admin cancels a subscription
router.post(`${BASE}/:id/cancel`, async (req, res) => {
  try {
    const { id } = req.params;
    const subscription = await Subscription.findById(id);
    if (!subscription) {
      return res.status(404).json({ error: 'Subscription not found' });
    }

    subscription.status = 'CANCELLED';
    await subscription.save();

    return res.status(200).json({ data: subscription });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/subscriptions/:id
// Get a single subscription
router.get(`${BASE}/:id`, async (req, res) => {
  try {
    const subscription = await Subscription.findById(req.params.id)
      .populate('user', 'firstName lastName phone accountNumber type')
      .populate('activatedBy', 'firstName lastName');

    if (!subscription) {
      return res.status(404).json({ error: 'Subscription not found' });
    }

    return res.status(200).json({ data: subscription });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
