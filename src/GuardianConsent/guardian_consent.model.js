// One row per (guardian, minor). Immutable — signatures never edited
// or deleted; if the guardian later removes the minor, the consent row
// stays as an audit record proving the guardian consented on the day.
//
// snapshotText captures the exact letter body the guardian saw, so
// future edits to CONSENT_TEXTS.V1 (or bump to V2) don't retroactively
// change what the guardian signed.

const mongoose = require('mongoose');
const actions = require('mongoose-rest-actions');

const { Schema, model } = mongoose;

const GuardianConsentSchema = new Schema(
  {
    guardian: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    minor: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    // Copy of the minor's display name at signing time so the audit
    // record is self-contained even if the User row is later deleted.
    minorName: { type: String, required: true, trim: true },
    // Consent version tag (V1, V2, ...) — matches consent_texts.js.
    consentVersion: { type: String, required: true, trim: true },
    // The exact letter body the guardian saw at signing time
    // (post-{MINOR_NAME} interpolation). Stored verbatim.
    snapshotText: { type: String, required: true },
    // 'sw' or 'en' — which locale the letter was shown in.
    locale: { type: String, enum: ['sw', 'en'], required: true },
    // Typed signature (the guardian's name as they entered it).
    signatureName: { type: String, required: true, trim: true },
    signedAt: { type: Date, default: Date.now, index: true },
    // Best-effort audit context (client-supplied, don't trust for auth).
    ipAddress: { type: String },
    userAgent: { type: String },
  },
  {
    id: false,
    timestamps: true,
    toJSON: { getters: true },
    toObject: { getters: true },
  }
);

// A guardian signs one consent per minor. Duplicate prevention.
GuardianConsentSchema.index({ guardian: 1, minor: 1 }, { unique: true });

mongoose.plugin(actions);

module.exports = model('GuardianConsent', GuardianConsentSchema);
