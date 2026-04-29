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

const PLAN_TYPES = ['MONTHLY', 'BIANNUAL', 'ANNUAL'];

const CURRENCIES = ['TZS', 'USD'];

const PAYMENT_METHODS = [
  'MANUAL', 'SELCOM', 'AZAMPAY', 'PAYPAL', 'GOOGLE_PAY', 'CARD',
];

const STATUS = ['ACTIVE', 'EXPIRED', 'PENDING', 'CANCELLED'];

const PRICES = {
  PLAYER: {
    MONTHLY:  { TZS: 5000,    USD: null },
    BIANNUAL: { TZS: 25000,   USD: null },
    ANNUAL:   { TZS: 50000,   USD: null },
  },
  SCOUT: {
    MONTHLY:  { TZS: null,    USD: null },
    BIANNUAL: { TZS: 150000,  USD: 50   },
    ANNUAL:   { TZS: 250000,  USD: 100  },
  },
  VENDOR: {
    MONTHLY:  { TZS: 100000,  USD: null },
    BIANNUAL: { TZS: 500000,  USD: null },
    ANNUAL:   { TZS: 1000000, USD: null },
  },
};

// Free promotion video slots per month per user type
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
      enum: ['PLAYER', 'SCOUT', 'VENDOR'],
      required: [true, 'userType is required'],
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

// Auto-set amount and promo slots from price table if not provided
SubscriptionSchema.pre('save', function (next) {
  if (!this.amount && this.userType && this.plan && this.currency) {
    const price = PRICES[this.userType]?.[this.plan]?.[this.currency];
    if (price) this.amount = price;
  }
  next();
});

// Activate a subscription: set dates based on plan
SubscriptionSchema.methods.activate = function (adminUserId) {
  const now = new Date();
  this.status = 'ACTIVE';
  this.startDate = now;
  this.activatedBy = adminUserId;
  this.activatedAt = now;
  this.promoSlotsTotal = FREE_PROMO_SLOTS[this.userType] || 0;
  this.promoSlotsUsed = 0;

  const end = new Date(now);
  if (this.plan === 'MONTHLY')  end.setMonth(end.getMonth() + 1);
  if (this.plan === 'BIANNUAL') end.setMonth(end.getMonth() + 6);
  if (this.plan === 'ANNUAL')   end.setFullYear(end.getFullYear() + 1);
  this.endDate = end;

  return this.save();
};

// Check if subscription is currently active
SubscriptionSchema.methods.isActive = function () {
  return this.status === 'ACTIVE' && this.endDate > new Date();
};

// Check if vendor has promo slots remaining
SubscriptionSchema.methods.hasPromoSlots = function () {
  return this.promoSlotsUsed < this.promoSlotsTotal;
};

// Use a promo slot
SubscriptionSchema.methods.usePromoSlot = function () {
  if (!this.hasPromoSlots()) return false;
  this.promoSlotsUsed += 1;
  this.save();
  return true;
};

// Static: check if a user has an active subscription
SubscriptionSchema.statics.isUserSubscribed = async function (userId) {
  const sub = await this.findOne({
    user: userId,
    status: 'ACTIVE',
    endDate: { $gt: new Date() },
  });
  return !!sub;
};

// Static: get active subscription for a user
SubscriptionSchema.statics.getActiveSubscription = async function (userId) {
  return this.findOne({
    user: userId,
    status: 'ACTIVE',
    endDate: { $gt: new Date() },
  });
};

mongoose.plugin(actions);

module.exports = {
  Subscription: model('Subscription', SubscriptionSchema),
  PRICES,
  PLAN_TYPES,
  CURRENCIES,
  PAYMENT_METHODS,
  FREE_PROMO_SLOTS,
};
