// A comment / complaint left by the beneficiary (or an admin acting
// on their behalf) on a specific Sponsorship entry. Sponsor gets an
// Inbox notification with a [COMMENT] pill.

const mongoose = require('mongoose');
const actions = require('mongoose-rest-actions');

const { Schema, model } = mongoose;

const COMMENT_KINDS = ['COMMENT', 'COMPLAINT'];

const SponsorshipCommentSchema = new Schema(
  {
    sponsorship: {
      type: Schema.Types.ObjectId,
      ref: 'Sponsorship',
      required: true,
      index: true,
    },
    author: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    kind: {
      type: String,
      enum: COMMENT_KINDS,
      default: 'COMMENT',
    },
    text: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

mongoose.plugin(actions);

module.exports = model('SponsorshipComment', SponsorshipCommentSchema);
module.exports.COMMENT_KINDS = COMMENT_KINDS;
