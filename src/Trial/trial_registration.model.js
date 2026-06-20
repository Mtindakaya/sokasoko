const mongoose = require('mongoose');
const { Schema, model } = mongoose;

const TrialRegistrationSchema = new Schema({
  trialId: { type: Schema.Types.ObjectId, ref: 'Trial', required: true, index: true },
  playerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  status: { type: String, enum: ['pending', 'confirmed', 'rejected'], default: 'pending' },
  notes: { type: String, trim: true },
}, { timestamps: true });

TrialRegistrationSchema.index({ trialId: 1, playerId: 1 }, { unique: true });

module.exports = model('TrialRegistration', TrialRegistrationSchema);
