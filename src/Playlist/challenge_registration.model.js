const mongoose = require('mongoose');

const { Schema, model } = mongoose;

// Entry record for a Challenge (Playlist with a brief). Shape depends
// on the brief's participationType:
//   INDIVIDUAL  — members = [registrant], org = null
//   GROUP       — members = [registrant, ...], length == brief.groupSize
//   ORG         — members = [], org = registrant (ACADEMY/CLUB/SCHOOL)
//
// Status defaults to ACTIVE because signup is open — ADMIN can
// WITHDRAW a rogue entry; the player can WITHDRAW their own.
const ChallengeRegistrationSchema = new Schema(
  {
    challenge: {
      type: Schema.Types.ObjectId,
      ref: 'Playlist',
      required: true,
      index: true,
    },
    participationType: {
      type: String,
      enum: ['INDIVIDUAL', 'GROUP', 'ORG'],
      required: true,
    },
    registrant: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    members: [{
      type: Schema.Types.ObjectId,
      ref: 'User',
    }],
    org: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'WITHDRAWN'],
      default: 'ACTIVE',
      index: true,
    },
    notes: { type: String, trim: true, default: '' },
  },
  { timestamps: true },
);

// A player can't double-enter an individual/group challenge; an org
// can only register itself once. Partial indexes keep withdrawn rows
// out of the uniqueness check so a cancelled entry doesn't block a
// re-register.
ChallengeRegistrationSchema.index(
  { challenge: 1, registrant: 1 },
  { unique: true, partialFilterExpression: { status: 'ACTIVE' } },
);

module.exports = model('ChallengeRegistration',
    ChallengeRegistrationSchema);
