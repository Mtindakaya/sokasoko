const express = require('express');
const { getString } = require('@lykmapipo/env');
const _ = require('lodash');
const {
  Subscription,
  PRICES,
  FEATURE_CAPS,
  PLAN_TYPES,
  TIERS,
  SUBSCRIPTION_ELIGIBLE_TYPES,
  NON_SUBSCRIPTION_TYPES,
  GRACE_PERIOD_DAYS,
} = require('./subscription.model');
const { SubscriptionUsage } = require('./subscription_usage.model');

const API_VERSION = getString('API_VERSION', '1.0.0');
const router = express.Router();
const BASE = `/v${API_VERSION.split('.')[0]}/subscriptions`;

// GET /v1/subscriptions/catalog
// Full plan + feature matrix for the frontend. Public.
router.get(`${BASE}/catalog`, (req, res) => {
  return res.status(200).json({
    data: {
      eligibleTypes: SUBSCRIPTION_ELIGIBLE_TYPES,
      nonSubscriptionTypes: NON_SUBSCRIPTION_TYPES,
      tiers: TIERS,
      plans: PLAN_TYPES,
      gracePeriodDays: GRACE_PERIOD_DAYS,
      prices: PRICES,
      features: FEATURE_CAPS,
    },
  });
});

// GET /v1/subscriptions/prices  (legacy alias — flat pricing table)
router.get(`${BASE}/prices`, (req, res) => {
  return res.status(200).json({ data: PRICES });
});

// GET /v1/subscriptions/me?userId=&userType=
// Effective tier for the caller plus current month's usage snapshot.
router.get(`${BASE}/me`, async (req, res) => {
  try {
    const { userId, userType } = req.query;
    if (!userId || !userType) {
      return res.status(400).json({ error: 'userId and userType are required' });
    }
    const [tier, snapshot, subscription] = await Promise.all([
      Subscription.getEffectiveTier(userId, userType),
      SubscriptionUsage.snapshot(userId, userType),
      Subscription.getActiveSubscription(userId),
    ]);
    return res.status(200).json({
      tier,
      usage: snapshot,
      subscription: subscription || null,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/subscriptions — admin list
router.get(BASE, async (req, res) => {
  try {
    const { status, userType, tier, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (status)   filter.status = status;
    if (userType) filter.userType = userType;
    if (tier)     filter.tier = tier;

    const [subscriptions, total] = await Promise.all([
      Subscription.find(filter)
        .populate('user', 'firstName lastName phone accountNumber type')
        .populate('activatedBy', 'firstName lastName')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(parseInt(limit))
        .lean(),
      Subscription.countDocuments(filter),
    ]);

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

// GET /v1/subscriptions/user/:userId — active subscription for a user.
router.get(`${BASE}/user/:userId`, async (req, res) => {
  try {
    const { userId } = req.params;
    const subscription = await Subscription.getActiveSubscription(userId);
    return res.status(200).json({
      isSubscribed: !!subscription,
      subscription: subscription || null,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/subscriptions
// Create a tier subscription (defaults to PENDING; admin activates).
router.post(BASE, async (req, res) => {
  try {
    const {
      user, userType, tier = 'STANDARD', plan,
      currency, paymentMethod, notes, transactionId,
    } = req.body;

    if (!user || !userType || !plan) {
      return res.status(400).json({ error: 'user, userType and plan are required' });
    }
    if (!SUBSCRIPTION_ELIGIBLE_TYPES.includes(userType)) {
      return res.status(400).json({ error: `${userType} is not subscription-eligible` });
    }
    if (!TIERS.includes(tier)) {
      return res.status(400).json({ error: 'invalid tier' });
    }
    if (!PLAN_TYPES.includes(plan)) {
      return res.status(400).json({ error: 'invalid plan' });
    }

    const selectedCurrency = currency || 'TZS';
    const amount = PRICES[userType]?.[tier]?.[plan]?.[selectedCurrency];
    if (amount == null) {
      return res.status(400).json({
        error: `Plan ${plan}/${selectedCurrency} is not offered for ${userType} ${tier}`,
      });
    }

    const subscription = await Subscription.create({
      user,
      userType,
      tier,
      plan,
      currency: selectedCurrency,
      amount,
      paymentMethod: paymentMethod || 'MANUAL',
      notes,
      transactionId,
      status: tier === 'STANDARD' ? 'ACTIVE' : 'PENDING',
    });

    // STANDARD is free — activate immediately.
    if (tier === 'STANDARD') {
      await subscription.activate(null);
    }

    return res.status(201).json({ data: subscription });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/subscriptions/:id/activate — admin manual activation.
router.post(`${BASE}/:id/activate`, async (req, res) => {
  try {
    const { id } = req.params;
    const adminUserId = _.get(req.body, 'adminUserId');
    const subscription = await Subscription.findById(id);
    if (!subscription) return res.status(404).json({ error: 'Subscription not found' });
    await subscription.activate(adminUserId);
    return res.status(200).json({ data: subscription });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/subscriptions/:id/cancel — admin cancel.
router.post(`${BASE}/:id/cancel`, async (req, res) => {
  try {
    const { id } = req.params;
    const subscription = await Subscription.findById(id);
    if (!subscription) return res.status(404).json({ error: 'Subscription not found' });
    subscription.status = 'CANCELLED';
    await subscription.save();
    return res.status(200).json({ data: subscription });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/subscriptions/lapse-sweep — admin/cron-triggered.
// Promotes ACTIVE→GRACE when endDate has passed, and
// GRACE→EXPIRED once gracePeriodEndsAt has passed.
router.post(`${BASE}/lapse-sweep`, async (req, res) => {
  try {
    const now = new Date();
    const activeToGrace = await Subscription.updateMany(
      { status: 'ACTIVE', endDate: { $lte: now } },
      { $set: { status: 'GRACE' } }
    );
    const graceToExpired = await Subscription.updateMany(
      { status: 'GRACE', gracePeriodEndsAt: { $lte: now } },
      { $set: { status: 'EXPIRED' } }
    );
    return res.status(200).json({
      activeToGrace: activeToGrace.modifiedCount || activeToGrace.nModified || 0,
      graceToExpired: graceToExpired.modifiedCount || graceToExpired.nModified || 0,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/subscriptions/:id — single record (keep last so it doesn't shadow /me, /catalog, etc.)
router.get(`${BASE}/:id`, async (req, res) => {
  try {
    const subscription = await Subscription.findById(req.params.id)
      .populate('user', 'firstName lastName phone accountNumber type')
      .populate('activatedBy', 'firstName lastName');
    if (!subscription) return res.status(404).json({ error: 'Subscription not found' });
    return res.status(200).json({ data: subscription });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
