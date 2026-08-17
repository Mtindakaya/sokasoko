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
  // Registered players have a User ref; guest players use playerName instead.
  player: { type: Schema.Types.ObjectId, ref: 'User', required: false },
  playerName: { type: String, trim: true },
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
    // PENDING = ref assigned but hasn't answered yet
    // ACCEPTED = ref confirmed the officiating role
    // DECLINED = ref refused; the referee slot itself is cleared but
    //           the status stays for audit
    refereeStatus: {
      type: String,
      enum: ['PENDING', 'ACCEPTED', 'DECLINED', null],
      default: null,
    },
    refereeResponseAt: { type: Date, default: null },
    assistantReferee1: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    assistantReferee1Status: {
      type: String,
      enum: ['PENDING', 'ACCEPTED', 'DECLINED', null],
      default: null,
    },
    assistantReferee1ResponseAt: { type: Date, default: null },
    assistantReferee2: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    assistantReferee2Status: {
      type: String,
      enum: ['PENDING', 'ACCEPTED', 'DECLINED', null],
      default: null,
    },
    assistantReferee2ResponseAt: { type: Date, default: null },
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
    scout: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    scoutStatus: {
      type: String,
      enum: ['PENDING', 'ACCEPTED', 'DECLINED'],
      default: 'PENDING',
    },
    scouts: [{
      scout: { type: Schema.Types.ObjectId, ref: 'User' },
      status: { type: String, enum: ['PENDING', 'ACCEPTED', 'DECLINED'], default: 'PENDING' },
      // Who initiated this scout request — the academy that owns a team,
      // or a player who plays on one of the teams.
      requestedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
      // 'ACADEMY' when the team owner attached the scout during match creation,
      // 'PLAYER' when a rostered player asked for the scout on an already
      // scheduled match. Drives how post-game report notifications get routed.
      requestType: { type: String, enum: ['ACADEMY', 'PLAYER'], default: 'ACADEMY' },
    }],
    tempScouts: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  },
  SCHEMA_OPTIONS
);

// Auto-mark as completed and generate matchId when both teams confirm
MatchSchema.pre('save', async function (next) {
  if (this.homeConfirmed && this.awayConfirmed && this.status !== 'COMPLETED') {
    this.status = 'COMPLETED';
    this._justCompleted = true;
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

// After a match completes, tell each involved referee where they stand
// against the free-game threshold. Fires only on the transition into
// COMPLETED (guarded by _justCompleted set in the pre-save above).
MatchSchema.post('save', async function () {
  if (!this._justCompleted) return;
  this._justCompleted = false;
  const refIds = [this.referee, this.assistantReferee1, this.assistantReferee2]
    .filter(Boolean).map(String);
  if (refIds.length === 0) return;
  try {
    const {
      Subscription,
      REFEREE_FREE_GAME_THRESHOLD,
      REFEREE_WARN_AT_GAMES,
    } = require('../Subscription/subscription.model');
    const Notification = require('../Notification/notification.model');
    for (const refId of refIds) {
      const [count, sub] = await Promise.all([
        Subscription.getRefereeGameCount(refId),
        Subscription.getActiveSubscription(refId),
      ]);
      const isSubbed = !!sub && ['MINOR', 'ADULT'].includes(sub.tier);
      if (isSubbed) continue; // no pushing subscribed refs
      let title = null;
      let body = null;
      if (count === REFEREE_WARN_AT_GAMES) {
        const left = REFEREE_FREE_GAME_THRESHOLD - REFEREE_WARN_AT_GAMES;
        title = 'Karibu utahitajika kujisajili';
        body = `Umeongoza mechi ${count}. Umebaki na mechi ${left} kabla ya kudaiwa uandikishaji ili uendelee kupewa mechi.`;
      } else if (count === REFEREE_FREE_GAME_THRESHOLD) {
        title = 'Uandikishaji unahitajika';
        body = `Umeongoza mechi ${count}. Jisajili sasa ili uendelee kupewa mechi.`;
      }
      if (title) {
        try {
          await Notification.create({
            userId: refId, title, body,
            type: 'SUBSCRIPTION',
            metadata: { role: 'REFEREE', gamesOfficiated: count },
          });
        } catch (_) { /* best-effort */ }
      }
    }
  } catch (err) {
    console.log('[match] referee post-complete hook failed:', err.message);
  }
});

mongoose.plugin(actions);

module.exports = model('Match', MatchSchema);
module.exports.MATCH_STATUS = MATCH_STATUS;
