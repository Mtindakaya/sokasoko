/**
 * OneTimePurchase — pay-per-action alternative to a tier upgrade.
 *
 * Product intent: if the caller's tier blocks a gated action AND they
 * are on Standard (per project decision to keep the offer to users
 * assumed to be constrained), we offer them a single-use purchase
 * instead of a hard "upgrade" wall. Higher tiers still hit the wall —
 * they are expected to upgrade.
 *
 * Lifecycle:
 *   PENDING  → user submitted, awaiting admin verification of payment.
 *              Auto-EXPIRED after PENDING_TTL_DAYS.
 *   PAID     → admin has approved; usable for USE_BY_DAYS.
 *   CONSUMED → the user took the gated action and burned the token.
 *   EXPIRED  → PENDING timed out OR PAID passed its use-by.
 *   REFUNDED → admin manually voided (not automated).
 */
const mongoose = require('mongoose');
const actions = require('mongoose-rest-actions');

const { Schema, model } = mongoose;

// Actions currently sold à-la-carte. Keep in sync with the enforcement
// call sites (POST /v1/trials, POST /v1/clinics, POST /v1/report-requests).
const ACTION_TYPES = [
  'POST_TRIAL',
  'POST_CLINIC',
  'REPORT_PLAYER',
  'REPORT_TEAM',
  'REPORT_MARKET',
  'REPORT_CUSTOM',
];

// Flat prices — kept intentionally lower than the corresponding
// subscription so subscription still wins for repeat users, but not so
// prohibitive that a one-off user gives up entirely.
const PRICES = {
  POST_TRIAL:    { TZS: 5000  },
  POST_CLINIC:   { TZS: 8000  },
  REPORT_PLAYER: { TZS: 3000  },
  REPORT_TEAM:   { TZS: 15000 },
  REPORT_MARKET: { TZS: 30000 },
  REPORT_CUSTOM: { TZS: 50000 },
};

// Which user types are ELIGIBLE to buy a one-time for each action. If a
// user type is not on this list, the gate returns a hard 403 with no
// purchase offer (e.g., AGENT can never post a clinic, even via
// purchase — clinics aren't part of the AGENT ladder).
const ELIGIBLE_TYPES = {
  POST_TRIAL:    ['COACH', 'ACADEMY', 'CLUB', 'AGENT'],
  POST_CLINIC:   ['COACH', 'ACADEMY', 'CLUB'], // VENDOR requires Platinum (upgrade only)
  REPORT_PLAYER: ['COACH', 'ACADEMY', 'CLUB', 'AGENT'],
  REPORT_TEAM:   ['COACH', 'ACADEMY', 'CLUB', 'AGENT'],
  REPORT_MARKET: ['COACH', 'ACADEMY', 'CLUB', 'AGENT'],
  REPORT_CUSTOM: ['AGENT'], // CUSTOM analysis is Enterprise-only via subscription
};

const STATUSES = ['PENDING', 'PAID', 'CONSUMED', 'EXPIRED', 'REFUNDED'];
const PAYMENT_METHODS = ['MANUAL', 'SELCOM', 'AZAMPAY', 'MPESA', 'PAYPAL', 'GOOGLE_PAY', 'CARD'];

const PENDING_TTL_DAYS = 5;   // Unapproved dies after 5 days.
const USE_BY_DAYS      = 30;  // Approved must be consumed within 30 days.

const OneTimePurchaseSchema = new Schema(
  {
    user:       { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    actionType: { type: String, enum: ACTION_TYPES, required: true, index: true },
    // Optional target — filled when the purchase was initiated in the
    // context of a specific in-progress resource (e.g., "the clinic the
    // user was trying to post"). Not required.
    resourceRef: { type: Schema.Types.ObjectId, default: null },

    priceAmount: { type: Number, required: true },
    currency:    { type: String, enum: ['TZS', 'USD'], default: 'TZS' },
    paymentMethod: { type: String, enum: PAYMENT_METHODS, default: 'MANUAL' },
    transactionId: { type: String, trim: true },
    notes:         { type: String, trim: true },

    status: { type: String, enum: STATUSES, default: 'PENDING', index: true },

    approvedAt:   { type: Date, default: null },
    approvedBy:   { type: Schema.Types.ObjectId, ref: 'User', default: null },
    consumedAt:   { type: Date, default: null },
    consumedResourceId: { type: Schema.Types.ObjectId, default: null },
    // Auto-computed from status + timestamps; the sweep uses this for
    // deterministic pending-expiry and use-by transitions.
    expiresAt:    { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

// Set expiresAt on create (5-day PENDING TTL). Approve endpoint resets
// it to now+USE_BY_DAYS. See routes for that logic.
OneTimePurchaseSchema.pre('save', function (next) {
  if (this.isNew && !this.expiresAt) {
    this.expiresAt = new Date(Date.now() + PENDING_TTL_DAYS * 24 * 60 * 60 * 1000);
  }
  next();
});

// Return the newest PAID + unexpired purchase for this user + action,
// or null. Used by the enforcement layer to decide whether to allow.
OneTimePurchaseSchema.statics.findConsumable = function (userId, actionType) {
  return this.findOne({
    user: userId, actionType, status: 'PAID',
    expiresAt: { $gt: new Date() },
  }).sort({ approvedAt: 1 }); // oldest-first — use earliest expiring
};

// Mark a purchase as consumed (call after resource creation succeeds).
OneTimePurchaseSchema.statics.consume = function (id, consumedResourceId) {
  return this.findByIdAndUpdate(id, {
    $set: {
      status: 'CONSUMED',
      consumedAt: new Date(),
      consumedResourceId: consumedResourceId || null,
    },
  }, { new: true });
};

mongoose.plugin(actions);

module.exports = model('OneTimePurchase', OneTimePurchaseSchema);
module.exports.ACTION_TYPES     = ACTION_TYPES;
module.exports.PRICES           = PRICES;
module.exports.ELIGIBLE_TYPES   = ELIGIBLE_TYPES;
module.exports.STATUSES         = STATUSES;
module.exports.PAYMENT_METHODS  = PAYMENT_METHODS;
module.exports.PENDING_TTL_DAYS = PENDING_TTL_DAYS;
module.exports.USE_BY_DAYS      = USE_BY_DAYS;
