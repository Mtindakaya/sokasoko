const mongoose = require('mongoose');
const actions = require('mongoose-rest-actions');

const { Schema, model } = mongoose;

const SCHEMA_OPTIONS = {
  id: false,
  timestamps: true,
  toJSON: { getters: true },
  toObject: { getters: true },
  emitIndexErrors: true,
};

// GROUP_THEN_KNOCKOUT covers the common youth-cup format used by
// Chipkizi Cup et al: round-robin groups feed a knockout bracket.
const TOURNAMENT_TYPES = [
  'LEAGUE',
  'CUP',
  'KNOCKOUT',
  'ROUND_ROBIN',
  'GROUP_THEN_KNOCKOUT',
  'FRIENDLY',
];
const TOURNAMENT_STATUS = ['DRAFT', 'OPEN', 'ONGOING', 'COMPLETED', 'CANCELLED'];
// Shares the canonical age-level list defined for matches so filtering
// stays consistent across the app (2026-10). Previously used an
// even-year youth ladder (U10/U12/…/SENIOR/OPEN); unified to the
// odd-year "U-plus-one" convention + explicit veteran brackets.
const AGE_GROUPS = [
  'U9', 'U11', 'U13', 'U15', 'U17', 'U19', 'U20', 'U23',
  'OPEN',
  'OVER_35', 'OVER_40', 'OVER_50',
];
const GENDERS = ['MALE', 'FEMALE', 'MIXED'];
const TOURNAMENT_TIERS = ['PREMIUM', 'SOKASOKO'];

const TournamentSchema = new Schema(
  {
    name: {
      type: String,
      required: [true, 'Tournament name is required'],
      trim: true,
      searchable: true,
      index: true,
    },
    type: {
      type: String,
      enum: TOURNAMENT_TYPES,
      required: [true, 'Tournament type is required'],
    },
    status: {
      type: String,
      enum: TOURNAMENT_STATUS,
      default: 'DRAFT',
      index: true,
    },
    // Legacy single field kept for backward compat — prefer categories[]
    ageGroup: {
      type: String,
      enum: [...AGE_GROUPS, null],
      default: null,
    },
    categories: [
      {
        gender: { type: String, enum: GENDERS, default: 'MIXED' },
        ageGroup: { type: String, enum: AGE_GROUPS, default: 'OPEN' },
        _id: false,
      },
    ],
    organizer: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Organizer is required'],
      index: true,
    },
    description: {
      type: String,
      trim: true,
    },
    startDate: {
      type: Date,
      required: [true, 'Start date is required'],
    },
    endDate: {
      type: Date,
      required: [true, 'End date is required'],
    },
    region: {
      type: String,
      trim: true,
    },
    district: {
      type: String,
      trim: true,
      default: '',
    },
    venue: {
      type: Schema.Types.ObjectId,
      ref: 'Venue',
      default: null,
    },
    teams: [
      {
        type: Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    maxTeams: {
      type: Number,
      default: 8,
    },
    // Deprecated free-text prize. Kept so existing docs keep rendering
    // until they're re-saved via the new create form.
    prize: {
      type: String,
      trim: true,
    },
    // Structured prizes: 1st place + runner-up. When `hasNoPrizes` is
    // true, the two prize strings are ignored and clients render "N/A".
    firstPrize: { type: String, trim: true, default: '' },
    runnerUpPrize: { type: String, trim: true, default: '' },
    hasNoPrizes: { type: Boolean, default: false },
    // Optional official scouts + referees attached to the tournament.
    // Organizer can nominate multiple of each at creation time (same
    // pattern used when scheduling a match).
    officialScouts: [{
      type: Schema.Types.ObjectId,
      ref: 'User',
    }],
    officialReferees: [{
      type: Schema.Types.ObjectId,
      ref: 'User',
    }],
    rules: {
      type: String,
      trim: true,
    },
    photo: {
      type: String,
      default: null,
    },
    // Tournament branding — separate from the organizer's profile
    // image. logoUrl + mascotUrl belong to the tournament itself;
    // hostLogoUrl is the organizer / hosting body's logo when it
    // differs from the organizer profile (e.g. a Chama running the
    // tournament under its own crest).
    logoUrl: { type: String, default: '' },
    mascotUrl: { type: String, default: '' },
    hostLogoUrl: { type: String, default: '' },
    // "SokaSoko 360" premium bundle — Enterprise-only. When
    // premiumBundle=FULL_360 AND premiumActivated=true, the advanced
    // features light up (fixture generator, live standings table,
    // knockout bracket rendering, public spectator page, roster
    // locking). Until activated, the tournament runs on the basic
    // stack (§3.26 Phase 1). Admin flips premiumActivated after the
    // customized-fee receipt is confirmed offline.
    premiumBundle: {
      type: String,
      enum: ['STANDARD', 'FULL_360'],
      default: 'STANDARD',
      index: true,
    },
    premiumActivated: { type: Boolean, default: false, index: true },
    premiumActivatedAt: { type: Date, default: null },
    premiumFeeReceipt: { type: String, trim: true, default: '' },
    // Sales-demo marker. Tournaments seeded by
    // tournament.demo_seed.js carry this so a cleanup script can
    // nuke them without touching real customer data.
    isDemoTournament: { type: Boolean, default: false, index: true },
    // Default match length (minutes) for fixtures scheduled under this
    // tournament. 90 covers adult. Youth festivals often use 60–70,
    // veteran formats sometimes 70. Each individual Match can still
    // override via its own durationMinutes.
    defaultMatchDurationMinutes: {
      type: Number,
      default: 90,
      min: 1,
      max: 180,
    },
    tier: {
      type: String,
      enum: TOURNAMENT_TIERS,
      default: 'PREMIUM',
      index: true,
    },
    // Publish gate. Organizer preps the tournament privately (default
    // false); flipping to true lists it in the public tournament
    // directory and enables registration. Owner always sees their
    // own drafts regardless of this flag.
    isPublished: {
      type: Boolean,
      default: false,
      index: true,
    },
    publishedAt: { type: Date, default: null },
  },
  SCHEMA_OPTIONS
);

TournamentSchema.index({ name: 'text', region: 'text' });

TournamentSchema.pre('save', function preValidate(done) {
  return this.preValidate(done);
});

TournamentSchema.methods.preValidate = async function preValidate(done) {
  return done();
};

mongoose.plugin(actions);

module.exports = model('Tournament', TournamentSchema);
module.exports.TOURNAMENT_TYPES = TOURNAMENT_TYPES;
module.exports.TOURNAMENT_STATUS = TOURNAMENT_STATUS;
module.exports.AGE_GROUPS = AGE_GROUPS;
module.exports.GENDERS = GENDERS;
module.exports.TOURNAMENT_TIERS = TOURNAMENT_TIERS;
