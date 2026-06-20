const mongoose = require('mongoose');
const { Schema, model } = mongoose;

const TrialSchema = new Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  organizer: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  date: { type: Date, required: true },
  time: { type: String, trim: true }, // e.g. "10:00 AM"
  location: { type: String, required: true, trim: true },
  region: { type: String, trim: true },
  gender: { type: String, enum: ['Male', 'Female', 'Both'], required: true, default: 'Both' },
  ageGroup: { type: String, trim: true }, // e.g. 'U16', 'U18', 'Open'
  positions: [{ type: String, trim: true }], // e.g. ['GK', 'ST']
  type: { type: String, enum: ['Open', 'Invite-Only'], default: 'Open' },
  maxParticipants: { type: Number },
  requirements: { type: String, trim: true },
  status: { type: String, enum: ['Open', 'Closed', 'Cancelled'], default: 'Open', index: true },
}, { timestamps: true });

TrialSchema.index({ date: 1 });
TrialSchema.index({ organizer: 1, createdAt: -1 });

module.exports = model('Trial', TrialSchema);
