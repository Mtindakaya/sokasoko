const mongoose = require('mongoose');

const { Schema, model } = mongoose;

const COACH_ROLES = [
  'Head Coach',
  'Assistant Coach',
  'Goalkeeper Coach',
  'Fitness Coach',
  'Youth Coach',
  'Youth Coordinator',
  'Technical Director',
  'Other',
];

const AGE_LEVELS = [
  'Senior',
  'U23', 'U20', 'U17', 'U15', 'U13', 'U11', 'U9',
];

const CvSchema = new Schema(
  {
    name: {
      type: String,
      required: [true, 'name is required'],
      trim: true,
    },
    isCurrent: { type: Boolean, default: false },
    // Player-CV: contact person + phone + role at the team (Manager/Coach)
    // — used to verify the player actually played there.
    person: { type: String },
    type: { type: String, enum: ['Manager', 'Coach'] },
    phone: String,
    // Coach-CV additions (all optional so existing player rows stay valid).
    // coach_role captures what the CV owner did at this team; when 'Other'
    // is chosen the freeform label lives in coach_role_other. age_levels
    // is multi-value because a coach can run several age groups at once.
    coach_role: { type: String, enum: [...COACH_ROLES, ''], default: '' },
    coach_role_other: { type: String, trim: true, default: '' },
    age_levels: [{ type: String, enum: AGE_LEVELS }],
    achievements: { type: String, trim: true, default: '' },
    // Team location. Auto-filled when the coach picks the team from
    // the org autocomplete; free-text when they type a custom name for
    // an org that isn't (yet) on SokaSoko. team_ref links back to the
    // User row when a known org was selected — null for typed names.
    region: { type: String, trim: true, default: '' },
    district: { type: String, trim: true, default: '' },
    team_ref: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    start_date: {
      type: Date,
      required: true,
    },
    end_date: {
      type: Date,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  {
    id: false,
    timestamps: true,
    toJSON: { getters: true },
    toObject: { getters: true },
    emitIndexErrors: true,
  }
);

module.exports = model('Cv', CvSchema);
