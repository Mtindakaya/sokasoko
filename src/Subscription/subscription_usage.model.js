const mongoose = require('mongoose');
const actions = require('mongoose-rest-actions');
const {
  Subscription,
  FEATURE_CAPS,
} = require('./subscription.model');

const { Schema, model } = mongoose;

// Features that are metered against per-tier caps.
// The value is the cap-field name on FEATURE_CAPS.
const FEATURE_CAP_FIELDS = {
  ai:                  'ai',
  reports:             'reportsPerMonth',
  evaluationsReceived: 'evaluationsReceivedPerMonth',
  evaluationRequests:  'evaluationRequestsInitiatedPerMonth',
};

const FEATURES = Object.keys(FEATURE_CAP_FIELDS);
const PERIODS = ['MONTH', 'DAY', 'HOUR'];

const monthKey = (d) => {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
};
const dayKey = (d) => `${monthKey(d)}-${String(d.getUTCDate()).padStart(2, '0')}`;
const hourKey = (d) => `${dayKey(d)}T${String(d.getUTCHours()).padStart(2, '0')}`;

const SubscriptionUsageSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    period:    { type: String, enum: PERIODS, required: true },
    periodKey: { type: String, required: true, index: true },
    userType:  { type: String, default: null },
    tier:      { type: String, default: null },
    // Counters — only the field for the metered feature is incremented.
    ai:                  { type: Number, default: 0 },
    reports:             { type: Number, default: 0 },
    evaluationsReceived: { type: Number, default: 0 },
    evaluationRequests:  { type: Number, default: 0 },
    // Auto-cleanup for short-lived DAY/HOUR docs.
    expiresAt: { type: Date, default: null, index: { expires: 0 } },
  },
  { timestamps: true }
);

SubscriptionUsageSchema.index(
  { user: 1, period: 1, periodKey: 1 },
  { unique: true }
);

// Atomically increment a counter in one bucket, return the new count.
async function bumpBucket(Model, { user, period, periodKey, feature, userType, tier, ttlHours }) {
  const setOnInsert = { userType, tier };
  if (ttlHours) {
    setOnInsert.expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
  }
  const doc = await Model.findOneAndUpdate(
    { user, period, periodKey },
    { $inc: { [feature]: 1 }, $setOnInsert: setOnInsert },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return doc;
}

// Roll back a previous increment (best-effort — usage counts on failure are
// off by ≤1 which is inside our margin).
async function rollback(Model, docId, feature) {
  try {
    await Model.updateOne({ _id: docId }, { $inc: { [feature]: -1 } });
  } catch (_) { /* swallow — non-critical */ }
}

// Try to consume 1 unit of `feature` for `user`. Enforces monthly cap from
// FEATURE_CAPS, plus hourly/daily fair-use for Platinum AI.
// Returns { allowed, cap, remaining, reason?, tier }.
SubscriptionUsageSchema.statics.consume = async function ({ user, userType, feature }) {
  if (!FEATURE_CAP_FIELDS[feature]) {
    throw new Error(`Unknown metered feature: ${feature}`);
  }
  const tier = await Subscription.getEffectiveTier(user, userType);
  if (tier === 'FREE') {
    // Excluded from subscriptions altogether — treat as unlimited.
    return { allowed: true, cap: null, remaining: null, tier };
  }
  const caps = FEATURE_CAPS[userType]?.[tier];
  if (!caps) {
    // No caps defined for this userType/tier yet — allow.
    return { allowed: true, cap: null, remaining: null, tier };
  }
  const capField = FEATURE_CAP_FIELDS[feature];
  const monthlyCap = caps[capField];

  // Hard zero — never touch monthly counter.
  if (monthlyCap === 0) {
    return { allowed: false, cap: 0, remaining: 0, reason: 'TIER_DISALLOWED', tier };
  }

  const now = new Date();
  const monthDoc = await bumpBucket(this, {
    user, period: 'MONTH', periodKey: monthKey(now), feature, userType, tier,
  });
  const monthCount = monthDoc[feature];

  if (monthlyCap != null && monthCount > monthlyCap) {
    await rollback(this, monthDoc._id, feature);
    return { allowed: false, cap: monthlyCap, remaining: 0, reason: 'MONTHLY_CAP', tier };
  }

  // Platinum AI fair-use (hourly + daily rate limits).
  if (feature === 'ai' && tier === 'PLATINUM') {
    const hourlyCap = caps.aiFairUsePerHour;
    const dailyCap  = caps.aiFairUsePerDay;

    if (hourlyCap != null) {
      const hDoc = await bumpBucket(this, {
        user, period: 'HOUR', periodKey: hourKey(now),
        feature, userType, tier, ttlHours: 2,
      });
      if (hDoc[feature] > hourlyCap) {
        await rollback(this, hDoc._id, feature);
        await rollback(this, monthDoc._id, feature);
        return { allowed: false, cap: hourlyCap, remaining: 0, reason: 'HOURLY_FAIR_USE', tier };
      }
    }
    if (dailyCap != null) {
      const dDoc = await bumpBucket(this, {
        user, period: 'DAY', periodKey: dayKey(now),
        feature, userType, tier, ttlHours: 48,
      });
      if (dDoc[feature] > dailyCap) {
        await rollback(this, dDoc._id, feature);
        await rollback(this, monthDoc._id, feature);
        return { allowed: false, cap: dailyCap, remaining: 0, reason: 'DAILY_FAIR_USE', tier };
      }
    }
  }

  return {
    allowed: true,
    cap: monthlyCap,
    remaining: monthlyCap == null ? null : Math.max(0, monthlyCap - monthCount),
    tier,
  };
};

// Read-only snapshot of the current month's usage for a user.
SubscriptionUsageSchema.statics.snapshot = async function (userId, userType) {
  const now = new Date();
  const doc = await this.findOne({
    user: userId,
    period: 'MONTH',
    periodKey: monthKey(now),
  }).lean();
  const tier = await Subscription.getEffectiveTier(userId, userType);
  const caps = FEATURE_CAPS[userType]?.[tier] || {};
  const out = { tier, month: monthKey(now), features: {} };
  for (const f of FEATURES) {
    const capField = FEATURE_CAP_FIELDS[f];
    const cap = caps[capField];
    const used = doc ? (doc[f] || 0) : 0;
    out.features[f] = {
      used,
      cap: cap == null ? null : cap, // null = unlimited
      remaining: cap == null ? null : Math.max(0, cap - used),
    };
  }
  return out;
};

mongoose.plugin(actions);

module.exports = {
  SubscriptionUsage: model('SubscriptionUsage', SubscriptionUsageSchema),
  FEATURE_CAP_FIELDS,
  FEATURES,
};
