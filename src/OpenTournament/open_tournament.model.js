const mongoose = require('mongoose');
const { Schema, model } = mongoose;

const OPEN_TOURNAMENT_TYPES = ['LEAGUE', 'CUP', 'KNOCKOUT', 'ROUND_ROBIN', 'FRIENDLY'];
const OPEN_TOURNAMENT_STATUS = ['DRAFT', 'ONGOING', 'COMPLETED', 'CANCELLED'];
const FIXTURE_STATUS = ['SCHEDULED', 'ONGOING', 'COMPLETED', 'CANCELLED'];

const SCHEMA_OPTIONS = {
  id: false,
  timestamps: true,
  toJSON: { getters: true },
  toObject: { getters: true },
};

const GoalscorerSchema = new Schema(
  {
    name: { type: String, trim: true, required: true },
    minute: { type: Number },
    isOwnGoal: { type: Boolean, default: false },
  },
  { _id: false }
);

const FixtureSchema = new Schema(
  {
    homeTeam: { type: String, trim: true, required: true },
    awayTeam: { type: String, trim: true, required: true },
    scheduledDate: { type: Date },
    venue: { type: String, trim: true },
    homeScore: { type: Number, default: null },
    awayScore: { type: Number, default: null },
    homeGoalscorers: [GoalscorerSchema],
    awayGoalscorers: [GoalscorerSchema],
    status: { type: String, enum: FIXTURE_STATUS, default: 'SCHEDULED' },
    notes: { type: String, trim: true },
    round: { type: String, trim: true },
  },
  { timestamps: true }
);

const TeamSchema = new Schema(
  {
    name: { type: String, trim: true, required: true },
    captain: { type: String, trim: true },
    contact: { type: String, trim: true },
  },
  { _id: false }
);

const OpenTournamentSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, index: true },
    type: { type: String, enum: OPEN_TOURNAMENT_TYPES, required: true },
    status: { type: String, enum: OPEN_TOURNAMENT_STATUS, default: 'DRAFT', index: true },
    organizer: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    description: { type: String, trim: true },
    startDate: { type: Date },
    endDate: { type: Date },
    location: { type: String, trim: true },
    prize: { type: String, trim: true },
    rules: { type: String, trim: true },
    photo: { type: String, default: null },
    teams: [TeamSchema],
    fixtures: [FixtureSchema],
  },
  SCHEMA_OPTIONS
);

OpenTournamentSchema.index({ name: 'text', location: 'text' });

module.exports = model('OpenTournament', OpenTournamentSchema);
module.exports.OPEN_TOURNAMENT_TYPES = OPEN_TOURNAMENT_TYPES;
module.exports.OPEN_TOURNAMENT_STATUS = OPEN_TOURNAMENT_STATUS;
module.exports.FIXTURE_STATUS = FIXTURE_STATUS;
