const mongoose = require('mongoose');

const { Schema, model } = mongoose;

const DocumentSchema = new Schema(
  {
    url: { type: String, required: true },
    label: { type: String, required: true }, // e.g. 'Birth Certificate', 'National ID'
  },
  { _id: false }
);

const TournamentRegistrationSchema = new Schema(
  {
    tournament: { type: Schema.Types.ObjectId, ref: 'Tournament', required: true, index: true },
    player: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    team: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    submittedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    jerseyNumber: { type: Number },
    position: { type: String },
    documents: [DocumentSchema],
    status: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'REJECTED'],
      default: 'PENDING',
      index: true,
    },
    rejectionReason: { type: String },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
    toObject: { getters: true },
  }
);

// One registration per player per tournament
TournamentRegistrationSchema.index({ tournament: 1, player: 1 }, { unique: true });

module.exports = model('TournamentRegistration', TournamentRegistrationSchema);
