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

// REFEREE-specific thresholds. Referees officiate free until they hit
// the game count; then a subscription is required. Warning fires at
// REFEREE_WARN_AT_GAMES so they have a chance to subscribe before block.
// Existing refs already past the threshold get a one-time grandfather
// window measured in days from the first eligibility check post-deploy.
const REFEREE_FREE_GAME_THRESHOLD = 10;
const REFEREE_WARN_AT_GAMES = 8;
const REFEREE_GRANDFATHER_DAYS = 5;

const PLAN_TYPES = ['MONTHLY', 'QUARTERLY', 'BIANNUAL', 'ANNUAL'];
const TIERS = ['STANDARD', 'GOLD', 'PLATINUM', 'ENTERPRISE', 'MINOR', 'ADULT', 'PRO'];
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
  // SCOUT: single PRO tier. No free STANDARD — an unsubscribed scout
  // cannot be selected for official work, cannot evaluate players, and
  // cannot file reports.
  SCOUT: {
    PRO: {
      MONTHLY:   { TZS: 10000, USD: null },
      QUARTERLY: { TZS: 25000, USD: null },
      BIANNUAL:  { TZS: 40000, USD: null },
    },
  },
  VENDOR:      { STANDARD: { MONTHLY: { TZS: 0, USD: 0 } } },
  FIELD_OWNER: { STANDARD: { MONTHLY: { TZS: 0, USD: 0 } } },
  // REFEREE: two age-based tiers. Server auto-picks MINOR vs ADULT from
  // user.dob at subscribe time; user does not choose. There is no free
  // STANDARD tier here — free access is granted via the game-count
  // free-trial (see REFEREE_FREE_GAME_THRESHOLD) rather than as a tier.
  REFEREE: {
    MINOR: {
      MONTHLY:   { TZS: 5000,  USD: null },
      QUARTERLY: { TZS: 10000, USD: null },
    },
    ADULT: {
      MONTHLY:   { TZS: 10000, USD: null },
      QUARTERLY: { TZS: 25000, USD: null },
      BIANNUAL:  { TZS: 40000, USD: null },
    },
  },
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
  // REFEREE tiers only gate one thing: match-assignment eligibility. Both
  // MINOR and ADULT unlock the same behaviour — the tier controls pricing,
  // not features.
  REFEREE: {
    MINOR: { matchAssignmentEligible: true },
    ADULT: { matchAssignmentEligible: true },
  },
  // SCOUT: PRO tier unlocks three things simultaneously — being pickable
  // for official scouting work, performing player evaluations, and filing
  // scout reports. All are gated together (no partial subscription).
  SCOUT: {
    PRO: {
      scoutAssignmentEligible: true,
      canEvaluatePlayers: true,
      canSubmitScoutReports: true,
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

// SCOUT eligibility: strict subscription gate — no free trial. Returns
// { eligible, subscribed, subscription }. Used to gate assignment,
// evaluation, and report submission for scouts.
SubscriptionSchema.statics.getScoutEligibility = async function (userId) {
  const sub = await this.getActiveSubscription(userId);
  const subscribed = !!sub && sub.tier === 'PRO';
  return {
    eligible: subscribed,
    subscribed,
    reason: subscribed ? 'SUBSCRIBED' : 'SUBSCRIPTION_REQUIRED',
    subscription: sub || null,
  };
};

// Count matches the referee has officiated (as head ref OR either
// assistant) that reached COMPLETED status.
SubscriptionSchema.statics.getRefereeGameCount = async function (userId) {
  const Match = mongoose.model('Match');
  return Match.countDocuments({
    status: 'COMPLETED',
    $or: [
      { referee: userId },
      { assistantReferee1: userId },
      { assistantReferee2: userId },
    ],
  });
};

// Which age bracket a referee's subscription should use, based on DOB.
// Under 18 → MINOR; 18+ or missing DOB → ADULT (safe default).
SubscriptionSchema.statics.getRefereeAgeBracket = function (dob) {
  if (!dob) return 'ADULT';
  const d = new Date(dob);
  if (isNaN(d.getTime())) return 'ADULT';
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
  return age < 18 ? 'MINOR' : 'ADULT';
};

// Full eligibility snapshot for a referee. Returns:
//   { eligible, reason, gamesOfficiated, subscribed, tier,
//     grandfatherEndsAt, threshold, warnAt }
// The one side effect: if the referee is at ≥threshold with no
// subscription and no grandfather stamp, this method sets
// user.refereeGrandfatherUntil = now + REFEREE_GRANDFATHER_DAYS on their User doc so the
// next check honours the grace window.
SubscriptionSchema.statics.getRefereeEligibility = async function (userId) {
  const User = mongoose.model('User');
  const [user, sub, games] = await Promise.all([
    User.findById(userId).select('dob refereeGrandfatherUntil type').lean(),
    this.getActiveSubscription(userId),
    this.getRefereeGameCount(userId),
  ]);
  const now = new Date();
  const subscribed = !!sub && ['MINOR', 'ADULT'].includes(sub.tier);
  const tier = subscribed ? sub.tier : null;

  if (subscribed) {
    return {
      eligible: true, reason: 'SUBSCRIBED',
      gamesOfficiated: games, subscribed: true, tier,
      grandfatherEndsAt: null,
      threshold: REFEREE_FREE_GAME_THRESHOLD,
      warnAt: REFEREE_WARN_AT_GAMES,
    };
  }

  if (games < REFEREE_FREE_GAME_THRESHOLD) {
    return {
      eligible: true, reason: 'FREE_TRIAL',
      gamesOfficiated: games, subscribed: false, tier: null,
      grandfatherEndsAt: null,
      threshold: REFEREE_FREE_GAME_THRESHOLD,
      warnAt: REFEREE_WARN_AT_GAMES,
    };
  }

  // At threshold with no subscription — apply / honour grandfather.
  let grandfatherEndsAt = user?.refereeGrandfatherUntil
    ? new Date(user.refereeGrandfatherUntil) : null;
  if (!grandfatherEndsAt) {
    grandfatherEndsAt = new Date(
      now.getTime() + REFEREE_GRANDFATHER_DAYS * 24 * 60 * 60 * 1000);
    try {
      await User.updateOne({ _id: userId },
        { $set: { refereeGrandfatherUntil: grandfatherEndsAt } });
    } catch (_) { /* non-critical */ }
  }
  const inGrace = grandfatherEndsAt > now;
  return {
    eligible: inGrace,
    reason: inGrace ? 'GRANDFATHER' : 'SUBSCRIPTION_REQUIRED',
    gamesOfficiated: games,
    subscribed: false,
    tier: null,
    grandfatherEndsAt,
    threshold: REFEREE_FREE_GAME_THRESHOLD,
    warnAt: REFEREE_WARN_AT_GAMES,
  };
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
  REFEREE_FREE_GAME_THRESHOLD,
  REFEREE_WARN_AT_GAMES,
  REFEREE_GRANDFATHER_DAYS,
};
