// A user (or coach/guardian on behalf of a linked account) requests
// a sponsor's support. Lands in the sponsor's Inbox with a [REQUEST]
// pill. Sponsor accepts (nothing auto-created — sponsor still fills
// the Sponsorship entry themselves; accept just clears the request)
// or declines.

const mongoose = require('mongoose');
const actions = require('mongoose-rest-actions');

const { Schema, model } = mongoose;

const REQUEST_STATUSES = ['PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED'];

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
  },
  { timestamps: true }
);

// Dedupe: one open PENDING request per (requester, sponsor, beneficiary).
SponsorshipRequestSchema.index(
  { sponsor: 1, requester: 1, beneficiary: 1 },
  { unique: true, partialFilterExpression: { status: 'PENDING' } }
);

mongoose.plugin(actions);

module.exports = model('SponsorshipRequest', SponsorshipRequestSchema);
module.exports.REQUEST_STATUSES = REQUEST_STATUSES;
