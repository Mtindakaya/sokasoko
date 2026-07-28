const mongoose = require('mongoose');
const { Schema, model } = mongoose;

// Football knowledge contributed by users. Approved entries become the
// SokaSoko local knowledge base that Ismaili will retrieve from in
// Phase 2b. At MVP no RAG — approved entries just accumulate for later.
const AdvisoryEntrySchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    body: { type: String, required: true, trim: true, maxlength: 10000 },

    topic: {
      type: String,
      enum: [
        'TACTICS', 'TRAINING', 'POSITION', 'RULES', 'REFEREEING',
        'SCOUTING', 'NUTRITION', 'MENTAL', 'HISTORY', 'OTHER',
      ],
      default: 'OTHER',
      index: true,
    },
    // Optional narrowing when topic is POSITION or the advisory is
    // position-specific. Codes match the scout evaluation form.
    position: {
      type: String,
      enum: ['GK', 'CB', 'FB', 'WB', 'DM', 'CM', 'AM', 'W', 'ST', ''],
      default: '',
    },
    ageGroup: {
      type: String,
      enum: ['U12','U13','U14','U15','U16','U17','U18','U20','U23','OPEN',''],
      default: '',
    },
    language: {
      type: String,
      enum: ['sw', 'en', 'mixed'],
      default: 'sw',
      index: true,
    },
    tags: [{ type: String, trim: true, lowercase: true }],

    source: {
      type: String,
      enum: ['CONTRIBUTOR', 'CHAT_RECYCLE'],
      default: 'CONTRIBUTOR',
      index: true,
    },
    contributor: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    status: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'REJECTED', 'ARCHIVED'],
      default: 'PENDING',
      index: true,
    },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    reviewerNote: { type: String, default: '' },
  },
  { timestamps: true }
);

// Compound index for the moderator queue and contributor's own list.
AdvisoryEntrySchema.index({ status: 1, createdAt: -1 });
AdvisoryEntrySchema.index({ contributor: 1, createdAt: -1 });

module.exports = model('AdvisoryEntry', AdvisoryEntrySchema);
