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
      // Now optional — external contributions arriving via WhatsApp,
      // web form, or email may not map to a User row until (and unless)
      // the contributor later creates an account.
      required: false,
      index: true,
    },

    // Which pipeline delivered this entry. Drives the triage workflow —
    // WHATSAPP items get transcribed weekly, WEB and EMAIL items get
    // moderator-reviewed as-is, APP items go straight to the review queue.
    sourceChannel: {
      type: String,
      enum: ['APP', 'WHATSAPP', 'WEB', 'EMAIL', 'AUDIO', 'CHAT_RECYCLE'],
      default: 'APP',
      index: true,
    },
    // Moderator priority for triage. 1 = urgent (transcribe + review now),
    // 5 = low. Nullable until a moderator has assessed the entry.
    priority: { type: Number, min: 1, max: 5, default: null },
    // Link to the raw asset (audio, PDF, image, etc.) in storage.
    // Present when a triaged entry originated from a media file we want
    // to preserve for the record.
    rawAssetUrl: { type: String, default: '' },
    // Freeform name + contact when the contributor has no User row yet.
    // Used to build a placeholder User later if the same person shows up
    // multiple times.
    contributorName: { type: String, default: '' },
    contributorContact: { type: String, default: '' },

    status: {
      type: String,
      // RAW = ingested via an intake channel, not yet moderator-triaged.
      // PENDING = ready for approve/reject review.
      // APPROVED = live in the knowledge base (used by Ismaili in Phase 2b).
      enum: ['RAW', 'PENDING', 'APPROVED', 'REJECTED', 'ARCHIVED'],
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
