const mongoose = require('mongoose');
const { Schema, model } = mongoose;

// Append-only log of a user's post-registration organisational history.
// Manual rows in the legacy Cv collection cover pre-SokaSoko years
// (with `end_date <= user.createdAt`). Everything from the moment a
// user joins the platform lives here — created lazily by the join /
// leave route hooks (academy verify, link/unlink school, link/unlink
// coach) so the CV screen always has both sides of the story.
//
// One event = one continuous stint at one org. `leftAt: null` means
// the stint is still active (current team). Closing the stint sets
// `leftAt` and optionally `leaveReason`.

const ENTITY_TYPES = ['ACADEMY', 'CLUB', 'SCHOOL'];
const ROLES = ['PLAYER', 'STUDENT', 'COACH'];
const SOURCES = [
  'ACADEMY_ENROLLMENT', // triggered by Academy row flip to VERIFIED
  'SCHOOL_LINK',        // triggered by link-school
  'COACH_LINK',         // triggered by link-coach
  'MANUAL',             // reserved — not used from the UI yet
];
// Coach-CV vocabulary — mirrors src/Cv/cv.model.js so future merges
// stay in step. Empty string is allowed so the record can be created
// before the coach fills details in via the "Edit age groups & role"
// action from the CV screen.
const COACH_ROLES = [
  '', 'Head Coach', 'Assistant Coach', 'Goalkeeper Coach',
  'Fitness Coach', 'Youth Coach', 'Youth Coordinator',
  'Technical Director', 'Other',
];
const AGE_LEVELS = ['Senior', 'U23', 'U20', 'U17', 'U15', 'U13', 'U11', 'U9'];

const CareerEventSchema = new Schema(
  {
    player: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    entity: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    entityType: { type: String, enum: ENTITY_TYPES, required: true },
    // Snapshot of the org's display name at join time so the CV row
    // renders correctly even if the org later renames.
    entityNameSnapshot: { type: String, trim: true, default: '' },
    // For PLAYER events this is the academy age band (U9..21+).
    // For STUDENT events this is the school class label (Form 4, etc).
    // Empty allowed for cases where the source didn't carry a level.
    level: { type: String, trim: true, default: '' },
    role: { type: String, enum: ROLES, required: true },
    joinedAt: { type: Date, required: true },
    leftAt: { type: Date, default: null, index: true },
    leaveReason: { type: String, trim: true, default: '' },
    source: { type: String, enum: SOURCES, required: true },
    sourceRef: { type: Schema.Types.ObjectId, default: null },
    // Coach-only fields — updated via PATCH from the CV screen so the
    // coach can specify what age groups they run at this org and their
    // formal role (mirrors Cv model's coach fields).
    coachRole: { type: String, enum: COACH_ROLES, default: '' },
    coachRoleOther: { type: String, trim: true, default: '' },
    ageLevels: [{ type: String, enum: AGE_LEVELS }],
    // Backfilled rows have unreliable joinedAt (best-guess from
    // user.updatedAt) — the client shows a small "estimated" chip.
    joinedAtEstimated: { type: Boolean, default: false },
  },
  { timestamps: true, toJSON: { getters: true }, toObject: { getters: true } }
);

// Hot query paths:
//   1. "my career events, newest first" → CV screen
//   2. "open event for this player at this org" → close on leave
CareerEventSchema.index({ player: 1, joinedAt: -1 });
CareerEventSchema.index({ player: 1, entity: 1, leftAt: 1 });

CareerEventSchema.statics.ENTITY_TYPES = ENTITY_TYPES;
CareerEventSchema.statics.ROLES = ROLES;
CareerEventSchema.statics.SOURCES = SOURCES;
CareerEventSchema.statics.COACH_ROLES = COACH_ROLES;
CareerEventSchema.statics.AGE_LEVELS = AGE_LEVELS;

module.exports = model('CareerEvent', CareerEventSchema);
