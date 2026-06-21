const mongoose = require('mongoose');
const { Schema, model } = mongoose;

const TrialRegistrationSchema = new Schema({
  trialId: { type: Schema.Types.ObjectId, ref: 'Trial', required: true, index: true },
  // player registration
  playerId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  // academy registration
  academyId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  registrantType: { type: String, enum: ['PLAYER', 'ACADEMY'], default: 'PLAYER' },
  selectedAgeGroup: { type: String, trim: true },
  // uploaded docs (URLs)
  dobDocument: { type: String, trim: true },
  passportPhoto: { type: String, trim: true },
  status: { type: String, enum: ['pending', 'confirmed', 'rejected'], default: 'pending' },
  notes: { type: String, trim: true },
}, { timestamps: true });

// sparse so null values don't violate uniqueness
TrialRegistrationSchema.index({ trialId: 1, playerId: 1 }, { unique: true, sparse: true });
TrialRegistrationSchema.index({ trialId: 1, academyId: 1 }, { unique: true, sparse: true });

module.exports = model('TrialRegistration', TrialRegistrationSchema);
