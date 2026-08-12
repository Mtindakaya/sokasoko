const mongoose = require('mongoose');
const { Schema, model } = mongoose;

// Session sub-schema for CLINIC eventType. Sessions live embedded on
// the parent Trial document — no separate collection.
const ClinicSessionSchema = new Schema({
  sessionNumber: { type: Number },
  date:          { type: Date },
  startTime:     { type: String, trim: true },
  endTime:       { type: String, trim: true },
  venue:         { type: Schema.Types.ObjectId, ref: 'Venue', default: null },
  topic:         { type: String, trim: true },
  topicSw:       { type: String, trim: true }, // Kiswahili
  status:        {
    type: String,
    enum: ['Scheduled', 'Ongoing', 'Completed', 'Cancelled'],
    default: 'Scheduled',
  },
  cancellationReason: { type: String, trim: true },
  completedAt:   { type: Date, default: null },
  completedBy:   { type: Schema.Types.ObjectId, ref: 'User', default: null },
}, { _id: true, timestamps: false });

const ClinicStaffSchema = new Schema({
  coach:  { type: Schema.Types.ObjectId, ref: 'User' },
  role:   {
    type: String,
    enum: ['LEAD', 'ASSISTANT', 'GOALKEEPING', 'FITNESS', 'PHYSIO'],
    default: 'ASSISTANT',
  },
  status: { type: String, enum: ['PENDING', 'ACCEPTED', 'DECLINED'], default: 'PENDING' },
}, { _id: true, timestamps: false });

const TrialSchema = new Schema({
  // Event discriminator — TRIAL or CLINIC. Legacy rows were backfilled to
  // 'TRIAL' via scripts/backfill-trial-type.js before this field went in.
  eventType: { type: String, enum: ['TRIAL', 'CLINIC'], default: 'TRIAL', index: true },
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
  scouts: [{
    scout:  { type: Schema.Types.ObjectId, ref: 'User' },
    status: { type: String, enum: ['PENDING', 'ACCEPTED', 'DECLINED'], default: 'PENDING' },
  }],

  // ── CLINIC-only fields (populated when eventType === 'CLINIC') ──────
  // Curriculum
  focusArea: {
    type: String,
    enum: [
      'FINISHING', 'GOALKEEPING', 'DEFENDING', 'BALL_MASTERY',
      'PASSING_RECEIVING', 'PHYSICAL_CONDITIONING', 'POSITION_SPECIFIC',
      'TACTICAL_AWARENESS', 'GENERAL_DEVELOPMENT',
    ],
  },
  positionFocus: [{ type: String, trim: true }],
  skillLevel: {
    type: String,
    enum: ['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'OPEN'],
  },
  learningObjectives:   [{ type: String, trim: true }],
  learningObjectivesSw: [{ type: String, trim: true }],

  // Session series
  sessions: [ClinicSessionSchema],
  enrolmentType: {
    type: String,
    enum: ['FULL_SERIES', 'DROP_IN_ALLOWED'],
    default: 'FULL_SERIES',
  },

  // Coaching staff
  leadCoach: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  staff: [ClinicStaffSchema],
  maxPlayersPerCoach:      { type: Number },
  scoutObservationAllowed: { type: Boolean, default: true },

  // Logistics
  equipmentProvided: [{ type: String, trim: true }],
  playerMustBring:   [{ type: String, trim: true }],
  mealsProvided:     { type: Boolean, default: false },
  transportProvided: { type: Boolean, default: false },

  // Fees (clinics use richer fee model than trials)
  feeBasis:        { type: String, enum: ['PER_SERIES', 'PER_SESSION', 'FREE'], default: 'FREE' },
  currency:        { type: String, enum: ['TZS', 'KES', 'UGX', 'RWF'], default: 'TZS' },
  allowInstalments:{ type: Boolean, default: false },

  // Safeguarding — ADVISORY ONLY. The bool flags are surfaced to
  // registrants as hints; the enrol handler does not hard-block on
  // missing docs. SokaSoko-run verification (Usahili/Uhakiki) is a
  // separate paid service and is not enforced from these fields.
  requiresGuardianConsent:    { type: Boolean, default: true },
  requiresMedicalDeclaration: { type: Boolean, default: true },
  // Free-text safeguarding notes the organizer wants public
  // (e.g. "Bring parent contact number, kit, water").
  safeguardingNotes: { type: String, trim: true, default: '' },
  // Extra documents the organizer expects attendees to bring on the
  // day. Displayed publicly; upload during enrol is optional.
  requiredDocuments: [{ type: String, trim: true }],
}, { timestamps: true });

TrialSchema.index({ startDate: 1 });
TrialSchema.index({ organizer: 1, createdAt: -1 });

module.exports = model('Trial', TrialSchema);
