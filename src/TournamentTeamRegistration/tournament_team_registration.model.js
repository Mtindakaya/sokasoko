const mongoose = require('mongoose');

const { Schema, model } = mongoose;

// A team's application to enter a specific category of a tournament.
// One team can hold multiple registrations against the same tournament
// if the tournament runs several (gender, ageGroup) categories — the
// team applies once per category they want to compete in.
const CategorySchema = new Schema(
  {
    gender: { type: String, enum: ['MALE', 'FEMALE', 'MIXED'], required: true },
    ageGroup: {
      type: String,
      enum: ['U10', 'U12', 'U14', 'U16', 'U18', 'U21', 'SENIOR', 'OPEN'],
      required: true,
    },
  },
  { _id: false },
);

const TournamentTeamRegistrationSchema = new Schema(
  {
    tournament: {
      type: Schema.Types.ObjectId,
      ref: 'Tournament',
      required: true,
      index: true,
    },
    team: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    category: { type: CategorySchema, required: true },
    submittedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    status: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN'],
      default: 'PENDING',
      index: true,
    },
    notes: { type: String, trim: true, default: '' },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    rejectionReason: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
    toObject: { getters: true },
  },
);

// One request per (tournament, team, category) — the team can't spam
// duplicate applications for the same slot. If they were rejected they
// can withdraw and re-apply after any organizer change.
TournamentTeamRegistrationSchema.index(
  { tournament: 1, team: 1, 'category.gender': 1, 'category.ageGroup': 1 },
  { unique: true },
);

module.exports = model(
  'TournamentTeamRegistration',
  TournamentTeamRegistrationSchema,
);
