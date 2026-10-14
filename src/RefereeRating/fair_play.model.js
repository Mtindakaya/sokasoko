const mongoose = require('mongoose');

const { Schema, model } = mongoose;

// Referee → Team fair play rating for a single match. One rating per
// (match, team); either referee may submit (match.referee is the
// head ref; assistants may also submit when future routes open it).
//
// score is 0..9 (0 = Poor, 9 = Excellent). notes is optional ref
// commentary. Aggregates (average of the last 5) feed the team's
// vCard and are exposed to associations / prize engines; the raw
// per-match scores stay private to admin + the ref who wrote them.
const FairPlayRatingSchema = new Schema({
  match: {
    type: Schema.Types.ObjectId,
    ref: 'Match',
    required: true,
    index: true,
  },
  team: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  opponent: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  score: {
    type: Number,
    required: true,
    min: 0,
    max: 9,
  },
  notes: { type: String, trim: true, default: '' },
  ratedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
}, { timestamps: true });

// One rating per team per match — a resubmission overwrites.
FairPlayRatingSchema.index({ match: 1, team: 1 }, { unique: true });

module.exports = model('FairPlayRating', FairPlayRatingSchema);
