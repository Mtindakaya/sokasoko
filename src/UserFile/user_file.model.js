const mongoose = require('mongoose');
const { Schema, model } = mongoose;

// Personal file vault. Every user can upload PDF/JPG/PNG documents into
// one of two visibility states:
//   PUBLIC — surfaced on the user's profile pane (Faili tab). Served
//     via permanent R2 pub-*.r2.dev URLs. Downloadable by anyone.
//   PRIVATE — only the owner (or admin) can list or fetch. Backend
//     generates short-lived signed URLs on demand.
//
// The killer use case is reuse: a player uploads their birth cert once
// as PRIVATE, then picks it from their vault during every future trial /
// clinic / tournament registration instead of re-uploading.
//
// Per-file cap 10MB. Per-account quota lives on FEATURE_CAPS as
// `storagePersonalBytes` per tier (STANDARD 50MB, GOLD 500MB,
// PLATINUM 1GB). Non-subscription types get the STANDARD baseline.

const VISIBILITIES = ['PUBLIC', 'PRIVATE'];

// Fixed enum — powers category-filter chips in the "Pick from my files"
// bottom sheet. Add new categories carefully; missing entries fall back
// to OTHER for legacy rows.
const CATEGORIES = [
  'BIRTH_CERT',
  'NATIONAL_ID',
  'PASSPORT',
  'MEDICAL_CLEARANCE',
  'SCHOOL_TRANSCRIPT',
  'COACHING_LICENSE',
  'REFEREE_LICENSE',
  'FIFA_ID',
  'ORG_REGISTRATION',
  'OTHER',
];

const MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

const UserFileSchema = new Schema(
  {
    owner: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    visibility: {
      type: String,
      enum: VISIBILITIES,
      required: true,
      default: 'PRIVATE',
    },
    category: {
      type: String,
      enum: CATEGORIES,
      required: true,
      default: 'OTHER',
    },
    // Human-facing display name. Owner can rename after upload; the
    // underlying R2 storageKey is immutable.
    displayName: { type: String, trim: true, required: true },
    // R2 object key: `file-repo/<userId>/<visibility>/<uuid>.<ext>`.
    // Storing this instead of the URL lets us regenerate URLs (signed
    // for private, direct for public) whenever needed.
    storageKey: { type: String, trim: true, required: true, unique: true },
    // Cached direct URL for PUBLIC files. Empty for PRIVATE (never
    // serve a direct URL — always signed). Populated on upload +
    // recomputed on visibility toggle.
    publicUrl: { type: String, trim: true, default: '' },
    mimeType: { type: String, enum: MIME_TYPES, required: true },
    size: { type: Number, required: true, min: 1 },
  },
  { timestamps: true, toJSON: { getters: true }, toObject: { getters: true } }
);

// Hot query paths:
//   1. "list this user's files, newest first" — vault UI
//   2. "list this user's files by category" — pick-from-files sheet
//   3. "total bytes used by this user" — quota check on upload
UserFileSchema.index({ owner: 1, visibility: 1, createdAt: -1 });
UserFileSchema.index({ owner: 1, category: 1, createdAt: -1 });

UserFileSchema.statics.VISIBILITIES = VISIBILITIES;
UserFileSchema.statics.CATEGORIES = CATEGORIES;
UserFileSchema.statics.MIME_TYPES = MIME_TYPES;

// Sum-by-owner helper for the quota check. Aggregation returns 0 when
// the owner has no files yet.
UserFileSchema.statics.totalBytesForOwner = async function (ownerId) {
  const [row] = await this.aggregate([
    { $match: { owner: new mongoose.Types.ObjectId(ownerId) } },
    { $group: { _id: null, total: { $sum: '$size' } } },
  ]);
  return row ? row.total : 0;
};

module.exports = model('UserFile', UserFileSchema);
