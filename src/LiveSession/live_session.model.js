const mongoose = require('mongoose');
const crypto = require('crypto');
const { Schema, model } = mongoose;

// One scheduled live broadcast on a presenter's profile pane. The
// admin (isAdmin=true) approves each request and owns the calendar
// so that scheduling collisions can be caught up front. Once a
// session goes LIVE the presenter's profile pane embeds the Jitsi
// room via WebView; viewers navigate to that profile to watch.
//
// Phase 1 constraints (2026-09-09):
//   - Broadcast only (audience joins muted, camera off, host + optional
//     speakers on stage).
//   - No automatic recording — needs JaaS/Jibri, deferred to Phase 1.5
//     alongside the S3/R2 storage migration.
//   - 60 min max duration, 24h minimum advance notice, one active
//     session at a time (admin calendar collision check).
//   - Cap per host per calendar month: GOLD=1, PLATINUM=5. Non-
//     subscription org types (SCHOOL / SPONSOR / FA) get a baseline
//     of 1. PLAYER and GUARDIAN are blocked outright.

const AUDIENCE_TYPES = ['GENERAL', 'SPECIFIC'];
const STATUSES = [
  'REQUESTED',
  'APPROVED',
  'REJECTED',
  'LIVE',
  'ENDED',
  'CANCELLED',
];

const LiveSessionSchema = new Schema(
  {
    host: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    approvedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      minlength: 3,
      maxlength: 100,
    },
    description: { type: String, trim: true, default: '', maxlength: 500 },
    scheduledFor: { type: Date, required: true, index: true },
    durationMinutes: { type: Number, default: 60, min: 5, max: 60 },
    audience: {
      type: String,
      enum: AUDIENCE_TYPES,
      required: true,
      default: 'GENERAL',
    },
    // Populated only when audience === 'SPECIFIC'. Otherwise ignored.
    audienceUsers: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    status: {
      type: String,
      enum: STATUSES,
      default: 'REQUESTED',
      index: true,
    },
    rejectReason: { type: String, trim: true, default: '' },
    cancelReason: { type: String, trim: true, default: '' },
    // Jitsi room slug — unguessable so nobody can squat rooms via URL
    // guessing before the session is approved.
    jitsiRoomId: { type: String, trim: true, default: '' },
    jitsiRoomUrl: { type: String, trim: true, default: '' },
    actualStartedAt: { type: Date, default: null },
    actualEndedAt: { type: Date, default: null },
    // Populated after Phase 1.5 lands (unlisted YouTube upload).
    recordingUrl: { type: String, trim: true, default: '' },
  },
  { timestamps: true, toJSON: { getters: true }, toObject: { getters: true } }
);

// Hot query paths:
//   1. "sessions on this profile, upcoming first"
//   2. "admin calendar for date range" — sorted by scheduledFor asc
//   3. "what's live right now" — status LIVE + presence
LiveSessionSchema.index({ host: 1, status: 1, scheduledFor: -1 });
LiveSessionSchema.index({ scheduledFor: 1, status: 1 });

// Generate the Jitsi room slug lazily on approval. Long random string
// + sokasoko prefix so anyone crawling meet.jit.si can't happen upon
// an unapproved room and camp in it.
LiveSessionSchema.statics.generateRoomId = function () {
  const rand = crypto.randomBytes(18).toString('base64url');
  return `sokasoko-${rand}`;
};

LiveSessionSchema.statics.AUDIENCE_TYPES = AUDIENCE_TYPES;
LiveSessionSchema.statics.STATUSES = STATUSES;

module.exports = model('LiveSession', LiveSessionSchema);
