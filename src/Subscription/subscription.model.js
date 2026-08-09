const mongoose = require('mongoose');
const actions = require('mongoose-rest-actions');

const { Schema, model } = mongoose;

const SCHEMA_OPTIONS = {
  id: false,
  timestamps: true,
  toJSON: { getters: true },
  toObject: { getters: true },
  emitIndexErrors: true,
};

// Grace period after endDate before tier auto-downgrades to STANDARD.
const GRACE_PERIOD_DAYS = 5;

const PLAN_TYPES = ['MONTHLY', 'QUARTERLY', 'BIANNUAL', 'ANNUAL'];
const TIERS = ['STANDARD', 'GOLD', 'PLATINUM', 'ENTERPRISE'];
const CURRENCIES = ['TZS', 'USD'];
const PAYMENT_METHODS = [
  'MANUAL', 'SELCOM', 'AZAMPAY', 'MPESA', 'PAYPAL', 'GOOGLE_PAY', 'CARD',
];
const STATUS = ['ACTIVE', 'GRACE', 'EXPIRED', 'PENDING', 'CANCELLED'];

// User types subject to subscription tiers.
const SUBSCRIPTION_ELIGIBLE_TYPES = [
  'PLAYER', 'COACH', 'ACADEMY', 'CLUB', 'AGENT',
  'REFEREE', 'SCOUT', 'VENDOR', 'FIELD_OWNER',
];
// User types excluded from subscriptions entirely.
const NON_SUBSCRIPTION_TYPES = ['GUARDIAN', 'SPONSOR', 'SCHOOL'];

// PRICES[userType][tier][plan][currency]. `null` = plan not offered for tier.
// STANDARD is universally free. Only PLAYER tiers are locked as of 2026-08-09.
const PRICES = {
  PLAYER: {
    STANDARD: {
      MONTHLY:   { TZS: 0, USD: 0 },
      QUARTERLY: { TZS: 0, USD: 0 },
      BIANNUAL:  { TZS: 0, USD: 0 },
    },
    GOLD: {
      MONTHLY:   { TZS: 5000,  USD: null },
      QUARTERLY: { TZS: 10000, USD: null },
      BIANNUAL:  { TZS: 20000, USD: null },
    },
    PLATINUM: {
      MONTHLY:   { TZS: 10000, USD: null },
      QUARTERLY: { TZS: 25000, USD: null },
      BIANNUAL:  { TZS: 40000, USD: null },
    },
  },
  // Other eligible types: pricing not yet locked. STANDARD free floor only.
  COACH:       { STANDARD: { MONTHLY: { TZS: 0, USD: 0 } } },
  ACADEMY:     { STANDARD: { MONTHLY: { TZS: 0, USD: 0 } } },
  CLUB:        { STANDARD: { MONTHLY: { TZS: 0, USD: 0 } } },
  AGENT:       { STANDARD: { MONTHLY: { TZS: 0, USD: 0 } } },
  REFEREE:     { STANDARD: { MONTHLY: { TZS: 0, USD: 0 } } },
  SCOUT:       { STANDARD: { MONTHLY: { TZS: 0, USD: 0 } } },
  VENDOR:      { STANDARD: { MONTHLY: { TZS: 0, USD: 0 } } },
  FIELD_OWNER: { STANDARD: { MONTHLY: { TZS: 0, USD: 0 } } },
};

// Feature caps per userType/tier. `null` = unlimited (with any fair-use
// caps applied at the endpoint). Only PLAYER is locked; other types will
// be filled in as their tier plans are defined.
const FEATURE_CAPS = {
  PLAYER: {
    STANDARD: {
      ai: 0,
      reportsPerMonth: 1,
      evaluationsReceivedPerMonth: 1,
      evaluationsShareWithPlayer: false,
      evaluationRequestsInitiatedPerMonth: 0,
      canJoinChallenges: false,
    },
    GOLD: {
      ai: 100,
      reportsPerMonth: 5,
      evaluationsReceivedPerMonth: 10,
      evaluationsShareWithPlayer: true,
      evaluationRequestsInitiatedPerMonth: 2,
      canJoinChallenges: true,
    },
    PLATINUM: {
      ai: null, // unlimited with fair-use
      aiFairUsePerHour: 30,
      aiFairUsePerDay: 300,
      reportsPerMonth: null,
      evaluationsReceivedPerMonth: null,
      evaluationsShareWithPlayer: true,
      evaluationRequestsInitiatedPerMonth: null,
      canJoinChallenges: true,
    },
  },
};

// Free promotion video slots per month per user type (legacy VENDOR feature).
const FREE_PROMO_SLOTS = {
  PLAYER: 0,
  SCOUT:  0,
  VENDOR: 2,
};

const SubscriptionSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'user is required'],
      index: true,
    },
    userType: {
      type: String,
      enum: SUBSCRIPTION_ELIGIBLE_TYPES,
      required: [true, 'userType is required'],
      index: true,
    },
    tier: {
      type: String,
      enum: TIERS,
      default: 'STANDARD',
      index: true,
    },
    plan: {
      type: String,
      enum: PLAN_TYPES,
      required: [true, 'plan is required'],
    },
    currency: {
      type: String,
      enum: CURRENCIES,
      default: 'TZS',
    },
    amount: {
      type: Number,
      required: [true, 'amount is required'],
    },
    paymentMethod: {
      type: String,
      enum: PAYMENT_METHODS,
      default: 'MANUAL',
    },
    status: {
      type: String,
      enum: STATUS,
      default: 'PENDING',
      index: true,
    },
    startDate: {
      type: Date,
      default: null,
    },
    endDate: {
      type: Date,
      default: null,
      index: true,
    },
    gracePeriodEndsAt: {
      type: Date,
      default: null,
    },
    activatedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    activatedAt: {
      type: Date,
      default: null,
    },
    notes: {
      type: String,
      trim: true,
    },
    transactionId: {
      type: String,
      trim: true,
    },
    promoSlotsUsed: {
      type: Number,
      default: 0,
    },
    promoSlotsTotal: {
      type: Number,
      default: 0,
    },
  },
  SCHEMA_OPTIONS
);

// Auto-set amount from price table if not provided.
SubscriptionSchema.pre('save', function (next) {
  if (this.amount == null && this.userType && this.tier && this.plan && this.currency) {
    const price = PRICES[this.userType]?.[this.tier]?.[this.plan]?.[this.currency];
    if (price != null) this.amount = price;
  }
  next();
});

// Activate a subscription: set dates based on plan.
SubscriptionSchema.methods.activate = function (adminUserId) {
  const now = new Date();
  this.status = 'ACTIVE';
  this.startDate = now;
  this.activatedBy = adminUserId;
  this.activatedAt = now;
  this.promoSlotsTotal = FREE_PROMO_SLOTS[this.userType] || 0;
  this.promoSlotsUsed = 0;

  const end = new Date(now);
  if (this.plan === 'MONTHLY')   end.setMonth(end.getMonth() + 1);
  if (this.plan === 'QUARTERLY') end.setMonth(end.getMonth() + 3);
  if (this.plan === 'BIANNUAL')  end.setMonth(end.getMonth() + 6);
  if (this.plan === 'ANNUAL')    end.setFullYear(end.getFullYear() + 1);
  this.endDate = end;
  this.gracePeriodEndsAt = new Date(end.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);

  return this.save();
};

// True if the subscription is currently ACTIVE or within grace period.
SubscriptionSchema.methods.isActive = function () {
  if (this.status === 'ACTIVE' && this.endDate > new Date()) return true;
  if (this.status === 'GRACE' && this.gracePeriodEndsAt > new Date()) return true;
  return false;
};

SubscriptionSchema.methods.hasPromoSlots = function () {
  return this.promoSlotsUsed < this.promoSlotsTotal;
};

SubscriptionSchema.methods.usePromoSlot = function () {
  if (!this.hasPromoSlots()) return false;
  this.promoSlotsUsed += 1;
  this.save();
  return true;
};

// Any ACTIVE-or-GRACE subscription counts as subscribed.
SubscriptionSchema.statics.isUserSubscribed = async function (userId) {
  const sub = await this.findOne({
    user: userId,
    status: { $in: ['ACTIVE', 'GRACE'] },
  });
  if (!sub) return false;
  return sub.isActive();
};

// Prefer the highest-tier active (or grace) subscription.
SubscriptionSchema.statics.getActiveSubscription = async function (userId) {
  const subs = await this.find({
    user: userId,
    status: { $in: ['ACTIVE', 'GRACE'] },
  });
  const alive = subs.filter((s) => s.isActive());
  if (alive.length === 0) return null;
  const weight = { PLATINUM: 3, GOLD: 2, STANDARD: 1, ENTERPRISE: 4 };
  alive.sort((a, b) => (weight[b.tier] || 0) - (weight[a.tier] || 0));
  return alive[0];
};

// Resolve the tier a user is currently entitled to.
// Returns 'STANDARD' for eligible types with no paid subscription,
// 'FREE' for non-subscription types (GUARDIAN/SPONSOR/SCHOOL).
SubscriptionSchema.statics.getEffectiveTier = async function (userId, userType) {
  if (NON_SUBSCRIPTION_TYPES.includes(userType)) return 'FREE';
  if (!SUBSCRIPTION_ELIGIBLE_TYPES.includes(userType)) return 'FREE';
  const sub = await this.getActiveSubscription(userId);
  return sub ? sub.tier : 'STANDARD';
};

// Convenience: look up the cap dict for a user type + tier.
SubscriptionSchema.statics.getFeatureCaps = function (userType, tier) {
  return FEATURE_CAPS[userType]?.[tier] || null;
};

mongoose.plugin(actions);

module.exports = {
  Subscription: model('Subscription', SubscriptionSchema),
  PRICES,
  FEATURE_CAPS,
  PLAN_TYPES,
  TIERS,
  CURRENCIES,
  PAYMENT_METHODS,
  STATUS,
  FREE_PROMO_SLOTS,
  SUBSCRIPTION_ELIGIBLE_TYPES,
  NON_SUBSCRIPTION_TYPES,
  GRACE_PERIOD_DAYS,
};
