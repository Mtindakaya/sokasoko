const mongoose = require('mongoose');
const { Schema, model } = mongoose;

// Per-session attendance entry — one per completed clinic session.
const AttendanceEntrySchema = new Schema({
  session:       { type: Schema.Types.ObjectId }, // matches sessions._id on parent Trial
  sessionNumber: { type: Number },
  sessionDate:   { type: Date },
  status: {
    type: String,
    enum: ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED', 'INJURED'],
    default: 'PRESENT',
  },
  note:     { type: String, trim: true },
  markedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  markedAt: { type: Date, default: Date.now },
}, { _id: false });

const TrialRegistrationSchema = new Schema({
  // TRIAL / CLINIC discriminator — legacy rows backfilled to 'TRIAL'.
  eventType: { type: String, enum: ['TRIAL', 'CLINIC'], default: 'TRIAL', index: true },

  trialId: { type: Schema.Types.ObjectId, ref: 'Trial', required: true, index: true },
  // player registration
  playerId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  // academy registration
  academyId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  registrantType: { type: String, enum: ['PLAYER', 'ACADEMY'], default: 'PLAYER' },
  selectedAgeGroup: { type: String, trim: true },
  // uploaded docs (URLs) — shared by TRIAL + CLINIC
  dobDocument: { type: String, trim: true },
  passportPhoto: { type: String, trim: true },
  // CLINIC vetting docs (also optional on TRIAL as a small vetting win)
  medicalDeclarationUrl: { type: String, trim: true },

  // CLINIC — attendance
  attendance: [AttendanceEntrySchema],
  sessionsBooked: [{ type: Schema.Types.ObjectId }], // drop-in mode

  // CLINIC — safeguarding
  guardianConsent: {
    given:        { type: Boolean, default: false },
    guardian:     { type: Schema.Types.ObjectId, ref: 'User' },
    guardianName: { type: String, trim: true },
    relationship: { type: String, enum: ['PARENT', 'GUARDIAN', 'SCHOOL_REP', 'OTHER'] },
    phone:        { type: String, trim: true },
    givenAt:      { type: Date },
  },
  emergencyContact: {
    name:         { type: String, trim: true },
    phone:        { type: String, trim: true },
    relationship: { type: String, trim: true },
  },
  medicalNotes:        { type: String, trim: true },
  hasMedicalCondition: { type: Boolean, default: false },

  status: {
    type: String,
    // Legacy trial rows use lowercase 'pending' etc; clinics add
    // 'completed' and 'withdrawn' terminal states.
    enum: ['pending', 'confirmed', 'rejected', 'approved', 'withdrawn', 'completed'],
    default: 'pending',
  },
  notes: { type: String, trim: true },
}, { timestamps: true });

// sparse so null values don't violate uniqueness
TrialRegistrationSchema.index({ trialId: 1, playerId: 1 }, { unique: true, sparse: true });
TrialRegistrationSchema.index({ trialId: 1, academyId: 1 }, { unique: true, sparse: true });

module.exports = model('TrialRegistration', TrialRegistrationSchema);
