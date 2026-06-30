const mongoose = require('mongoose');
const { Schema, model } = mongoose;

const TrialSchema = new Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  organizer: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

  // Contact
  contactName: { type: String, trim: true },
  contactEmail: { type: String, trim: true },
  contactPhone: { type: String, trim: true },

  // Date range
  startDate: { type: Date, required: true },
  endDate: { type: Date },
  startTime: { type: String, trim: true },
  endTime: { type: String, trim: true },

  // Location
  location: { type: String, required: true, trim: true },
  region: { type: String, trim: true },
  district: { type: String, trim: true },
  ward: { type: String, trim: true },

  gender: { type: String, enum: ['Male', 'Female', 'Both'], required: true, default: 'Both' },
  ageGroups: [{ type: String, trim: true }],
  positions: [{ type: String, trim: true }],
  trialFor: { type: String, enum: ['Players', 'Academies', 'Both'], default: 'Players' },
  type: { type: String, enum: ['Open', 'Invite-Only'], default: 'Open' },
  maxParticipants: { type: Number },
  registrationFee: { type: Number, default: 0 },
  requirements: { type: String, trim: true },
  status: { type: String, enum: ['Open', 'Closed', 'Cancelled'], default: 'Open', index: true },
  scouts: [{ type: Schema.Types.ObjectId, ref: 'User' }],
}, { timestamps: true });

TrialSchema.index({ startDate: 1 });
TrialSchema.index({ organizer: 1, createdAt: -1 });

module.exports = model('Trial', TrialSchema);
