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

    // Public reach metric. Denormalised counter — the AdvisoryView
    // collection holds per-viewer rows for analytics / compensation.
    viewCount: { type: Number, default: 0, index: true },

    // Public engagement — heart tap on the Maarifa ya Umma tab. We keep
    // the actual voter ids as an array so the API can tell a viewer
    // whether they've already liked, and so the aggregate reflects a
    // deduped unique-user count. likeCount is denormalised for the
    // listing cards so we don't need to count array lengths at query
    // time once the collection grows.
    likedBy: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    likeCount: { type: Number, default: 0, index: true },

    // Veteran contributions are credited publicly with the contributor's
    // name (or a curated stage name). Snapshotted at write time so an
    // admin un-flagging the user later doesn't retroactively strip
    // credit from already-published entries.
    isVeteranContribution: { type: Boolean, default: false, index: true },
    veteranDisplayName: { type: String, default: '' },

    // Opt-out of identity on the public tab. Default is false (identity
    // revealed) — contributors who actively tick the "anonymous" box on
    // the submission form flip this to true and the public endpoint
    // strips name + profile image + account number before responding.
    // Veteran contributions bypass this flag (the whole point of the
    // veteran credit is the attribution).
    isAnonymous: { type: Boolean, default: false, index: true },

    // Demographic snapshot of the contributor at the moment of
    // submission. Non-public (public API strips these before returning
    // the entry) — reserved for internal analytics + the data-
    // sovereignty / monetisation research track. Snapshotting locks the
    // numbers in time so a contributor moving city or ageing out of a
    // bracket doesn't rewrite the historical dataset.
    snapshotUserType: { type: String, default: '', index: true },
    snapshotGender: { type: String, default: '' },
    snapshotDob: { type: Date, default: null },
    snapshotRegion: { type: String, default: '' },
    snapshotDistrict: { type: String, default: '' },
    snapshotWard: { type: String, default: '' },
  },
  { timestamps: true }
);

// Compound index for the moderator queue and contributor's own list.
AdvisoryEntrySchema.index({ status: 1, createdAt: -1 });
AdvisoryEntrySchema.index({ contributor: 1, createdAt: -1 });

module.exports = model('AdvisoryEntry', AdvisoryEntrySchema);
