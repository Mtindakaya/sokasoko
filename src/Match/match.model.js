const mongoose = require('mongoose');
const Counter = require('../Counter/counter.model');
const actions = require('mongoose-rest-actions');

const { Schema, model } = mongoose;

const SCHEMA_OPTIONS = {
  id: false,
  timestamps: true,
  toJSON: { getters: true },
  toObject: { getters: true },
  emitIndexErrors: true,
};

const MATCH_STATUS = ['SCHEDULED', 'ONGOING', 'COMPLETED', 'CANCELLED', 'POSTPONED', 'DECLINED'];

const PlayerStatSchema = new Schema({
  player: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  team: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  isGuest: { type: Boolean, default: false },
  jerseyNumber: { type: Number },
  position: { type: String },
  minutesPlayed: { type: Number, default: 0 },
  goals: { type: Number, default: 0 },
  assists: { type: Number, default: 0 },
  yellowCards: { type: Number, default: 0 },
  redCards: { type: Number, default: 0 },
  started: { type: Boolean, default: true },
}, { _id: true });

const MatchSchema = new Schema(
  {
    matchId: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },
    homeTeam: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Home team is required'],
      index: true,
    },
    awayTeam: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Away team is required'],
      index: true,
    },
    venue: {
      type: Schema.Types.ObjectId,
      ref: 'Venue',
      default: null,
    },
    tournament: {
      type: Schema.Types.ObjectId,
      ref: 'Tournament',
      default: null,
      index: true,
    },
    scheduledDate: {
      type: Date,
      required: [true, 'Match date is required'],
      index: true,
    },
    status: {
      type: String,
      enum: MATCH_STATUS,
      default: 'SCHEDULED',
      index: true,
    },
    homeScore: {
      type: Number,
      default: null,
    },
    awayScore: {
      type: Number,
      default: null,
    },
    scheduleConfirmed: {
      type: Boolean,
      default: false,
    },
    scheduleDeclined: {
      type: Boolean,
      default: false,
    },
    scheduleDeclinedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    scheduleDeclineReason: {
      type: String,
      default: null,
    },
    scheduleConfirmedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    homeConfirmed: {
      type: Boolean,
      default: false,
    },
    awayConfirmed: {
      type: Boolean,
      default: false,
    },
    homeConfirmedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    awayConfirmedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    playerStats: [PlayerStatSchema],
    notes: {
      type: String,
      trim: true,
    },
    referee: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    assistantReferee1: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    assistantReferee2: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    homeCoach: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    awayCoach: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    scheduledBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  SCHEMA_OPTIONS
);

// Auto-mark as completed and generate matchId when both teams confirm
MatchSchema.pre('save', async function (next) {
  if (this.homeConfirmed && this.awayConfirmed && this.status !== 'COMPLETED') {
    this.status = 'COMPLETED';
    if (!this.matchId) {
      try {
        const counter = await Counter.getNextSequenceValue('matchId');
        this.matchId = `TFH-M-${counter.toString().padStart(6, '0')}`;
      } catch (e) {
        console.log('matchId generation error:', e.message);
      }
    }
  }
  next();
});

mongoose.plugin(actions);

module.exports = model('Match', MatchSchema);
module.exports.MATCH_STATUS = MATCH_STATUS;
