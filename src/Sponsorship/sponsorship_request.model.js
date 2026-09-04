// A user (or coach/guardian on behalf of a linked account) requests
// a sponsor's support. Lands in the sponsor's Inbox with a [REQUEST]
// pill. Sponsor accepts (nothing auto-created — sponsor still fills
// the Sponsorship entry themselves; accept just clears the request)
// or declines.

const mongoose = require('mongoose');
const actions = require('mongoose-rest-actions');

const { Schema, model } = mongoose;

const REQUEST_STATUSES = ['PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'EXPIRED'];

// PENDING requests auto-expire after this many days. Enforced by the
// router helper before create + list (so a stale PENDING doesn't block
// a new request via the dedupe unique index).
const REQUEST_EXPIRY_DAYS = 30;

const SponsorshipRequestSchema = new Schema(
  {
    sponsor:     { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    requester:   { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // The user proposed to receive the sponsorship. Often === requester
    // but a coach/guardian can request on behalf of a linked account.
    beneficiary: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    message:     { type: String, trim: true, default: '' },
    status: {
      type: String,
      enum: REQUEST_STATUSES,
      default: 'PENDING',
      index: true,
    },
    respondedAt: { type: Date, default: null },
    responseNote: { type: String, trim: true, default: '' },
    // Cut-off after which a PENDING request is auto-marked EXPIRED.
    // Default = createdAt + REQUEST_EXPIRY_DAYS at write time (see
    // pre-validate hook).
    expiresAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

SponsorshipRequestSchema.pre('validate', function setExpiry(next) {
  if (this.isNew && !this.expiresAt) {
    this.expiresAt = new Date(
      Date.now() + REQUEST_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    );
  }
  next();
});

// Dedupe: one open PENDING request per (requester, sponsor, beneficiary).
SponsorshipRequestSchema.index(
  { sponsor: 1, requester: 1, beneficiary: 1 },
  { unique: true, partialFilterExpression: { status: 'PENDING' } }
);

mongoose.plugin(actions);

module.exports = model('SponsorshipRequest', SponsorshipRequestSchema);
module.exports.REQUEST_STATUSES = REQUEST_STATUSES;
module.exports.REQUEST_EXPIRY_DAYS = REQUEST_EXPIRY_DAYS;
