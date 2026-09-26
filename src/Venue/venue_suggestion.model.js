const mongoose = require('mongoose');

const { Schema, model } = mongoose;

// Pending-review record created when an org typed a home-field name
// during signup that didn't match any existing curated Venue in that
// ward. Admin CMS reviews the queue and either APPROVES (creates a
// real Venue and rewires any org's homeVenueSuggestion to the new
// homeVenue) or REJECTS with a note. Org sees the pending state on
// their Info Zaidi until it's resolved.
const VenueSuggestionSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    region: { type: String, required: true, trim: true, index: true },
    district: { type: String, required: true, trim: true, index: true },
    ward: { type: String, trim: true, index: true },
    // Ownership hint from the suggesting org. Admin uses this to
    // pre-fill Venue.owners when they approve, but can override.
    ownerType: {
      type: String,
      enum: ['SELF', 'REF', 'MANUAL', 'UNKNOWN'],
      default: 'UNKNOWN',
    },
    ownerRef: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    ownerName: { type: String, trim: true, default: '' },
    // Suggester = the org account that submitted the entry.
    suggestedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    // Physical field format the org reported. Kept optional (UNKNOWN
     // default) — admin can override on approve. Enum mirrors Venue.
    fieldSize: {
      type: String,
      enum: [
        'FIVE_A_SIDE',
        'SEVEN_A_SIDE',
        'NINE_A_SIDE',
        'ELEVEN_A_SIDE',
        'MULTI',
        'FUTSAL',
        'UNKNOWN',
      ],
      default: 'UNKNOWN',
    },
    // Optional free-text context the org supplied.
    notes: { type: String, trim: true, default: '' },
    status: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'REJECTED'],
      default: 'PENDING',
      index: true,
    },
    reviewedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    reviewedAt: { type: Date, default: null },
    rejectionReason: { type: String, trim: true, default: '' },
    // Populated on APPROVE — points at the Venue row admin created.
    approvedVenue: {
      type: Schema.Types.ObjectId,
      ref: 'Venue',
      default: null,
    },
  },
  { timestamps: true },
);

VenueSuggestionSchema.index({ region: 1, district: 1, ward: 1, status: 1 });

module.exports = model('VenueSuggestion', VenueSuggestionSchema);
