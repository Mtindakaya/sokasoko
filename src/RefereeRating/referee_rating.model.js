const mongoose = require('mongoose');

const Schema = mongoose.Schema;

const RefereeRatingSchema = new Schema(
  {
    match: { type: Schema.Types.ObjectId, ref: 'Match', required: true },
    referee: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    ratedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    stars: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, trim: true },
  },
  { timestamps: true }
);

// One rating per coach per match
RefereeRatingSchema.index({ match: 1, ratedBy: 1 }, { unique: true });

module.exports = mongoose.model('RefereeRating', RefereeRatingSchema);
