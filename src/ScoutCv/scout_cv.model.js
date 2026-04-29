const mongoose = require('mongoose');
const { Schema, model } = mongoose;

const ScoutCvSchema = new Schema(
  {
    scout: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    // Registered player account (if player is on the system)
    playerRef: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    // Full name — auto-populated from playerRef or manually entered
    playerName: {
      type: String,
      required: true,
      trim: true,
    },
    yearIdentified: {
      type: Number,
      required: true,
    },
    // Registered academy at time of identification
    academyAtIdentification: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    // Manual name if not a registered entity
    academyAtIdentificationName: {
      type: String,
      trim: true,
    },
    // Registered current club/academy
    currentClub: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    // Manual name if not registered
    currentClubName: {
      type: String,
      trim: true,
    },
    // UNVERIFIED = not on system, no verification requested
    // PENDING    = request sent, player has not responded
    // VERIFIED   = player confirmed
    // DECLINED   = player declined (entry auto-deleted)
    verificationStatus: {
      type: String,
      enum: ['UNVERIFIED', 'PENDING', 'VERIFIED', 'DECLINED'],
      default: 'UNVERIFIED',
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
    toObject: { getters: true },
  }
);

module.exports = model('ScoutCv', ScoutCvSchema);
