const mongoose = require('mongoose');
const actions = require('mongoose-rest-actions');

const { Schema, model } = mongoose;

// '21+' is the CLUB senior-team level. Older Academy rows never used
// it — safe to add to the enum without a migration.
const levels = ['21+', 'U20', 'U17', 'U15', 'U13', 'U11', 'U9'];

// PENDING = academy has sent the invite, player hasn't verified yet
// VERIFIED = player accepted → User.academy points at this row + roster
//            caps count this row + player shows as enrolled
// REJECTED = player declined → row kept for audit, no linkage on User
const verificationStatuses = ['PENDING', 'VERIFIED', 'REJECTED'];

const AcademySchema = new Schema(
  {
    player: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      autopopulate: true,
      // NOTE: was unique — dropped because a REJECTED row must still
      // allow the same player to receive a fresh invite. Uniqueness
      // is now enforced at the router-check level (only one
      // PENDING+VERIFIED row per player, REJECTED rows unlimited).
    },
    level: {
      type: String,
      enum: levels,
      required: true,
    },
    addedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      autopopulate: true,
    },
    verificationStatus: {
      type: String,
      enum: verificationStatuses,
      default: 'PENDING',
      index: true,
    },
    verifiedAt: { type: Date, default: null },
    rejectedAt: { type: Date, default: null },
  },
  {
    id: false,
    timestamps: true,
    toJSON: { getters: true },
    toObject: { getters: true },
    emitIndexErrors: true,
  }
);

mongoose.plugin(actions);

module.exports = model('Academy', AcademySchema);
