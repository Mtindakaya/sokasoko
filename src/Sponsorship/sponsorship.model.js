// Sponsorship = a sponsor's declaration of support for a specific
// beneficiary account. Multiple entries per (sponsor, beneficiary)
// are allowed — each entry is one act of support (e.g. "boots 2024",
// "school fees 2025", "ongoing coaching 2026-").
//
// Not a bilateral agreement — no beneficiary approval needed. The
// beneficiary CAN comment/complain via a separate SponsorshipComment.

const mongoose = require('mongoose');
const actions = require('mongoose-rest-actions');

const { Schema, model } = mongoose;

const SUPPORT_KINDS = ['ONE_TIME_DATE', 'DATE_RANGE', 'ONGOING'];

const SponsorshipSchema = new Schema(
  {
    sponsor: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    beneficiary: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    title:       { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    supportKind: {
      type: String,
      enum: SUPPORT_KINDS,
      required: true,
    },
    // Populated when supportKind === 'ONE_TIME_DATE'.
    supportDate:  { type: Date, default: null },
    // Populated when supportKind === 'DATE_RANGE'.
    supportStart: { type: Date, default: null },
    supportEnd:   { type: Date, default: null },
    // Up to 3 photo URLs (uploader.js writes S3 URLs when configured;
    // local disk fallback otherwise — see AWS_ACCESS_KEY_ID env).
    photos: {
      type: [String],
      default: [],
      validate: [
        (arr) => arr.length <= 3,
        'A sponsorship entry may carry up to 3 photos',
      ],
    },
  },
  { timestamps: true }
);

SponsorshipSchema.index({ sponsor: 1, beneficiary: 1, createdAt: -1 });

mongoose.plugin(actions);

module.exports = model('Sponsorship', SponsorshipSchema);
module.exports.SUPPORT_KINDS = SUPPORT_KINDS;
