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
const AGE_GROUPS = ['U10', 'U12', 'U14', 'U16', 'U18', 'U21', 'SENIOR', 'OPEN'];
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
