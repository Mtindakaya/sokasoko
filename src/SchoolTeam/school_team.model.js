const mongoose = require('mongoose');

const { Schema, model } = mongoose;

// FormTeam = the all-stars team for a single form / grade / year of a
// school. One per form level per school. ClassTeam = the team for a
// specific stream (A, B, C...) within that form; multiple per form.
//
// Both share:
//   school               ref User, SCHOOL type, required
//   formLevel            same enum as User.school_form (plus YEAR_1..4
//                        for college), required
//   captain              ref User (PLAYER), optional on form team,
//                        de-facto required on class team (set via the
//                        dedicated endpoint)
//   assistantCaptain     ref User (PLAYER), optional
//   players              list of ref User (PLAYER), cap 18 incl.
//                        captain + assistant captain
//   active               bool. false = disabled; captain can't act on
//                        a disabled team. Only Sports Teacher can
//                        toggle.
//
// ClassTeam adds:
//   streamLetter         A / B / C / ... — the stream label under the
//                        form, required
//
// Unique index per (school, formLevel) for FormTeam so a school can't
// register two all-stars teams for the same grade. Unique per
// (school, formLevel, streamLetter) for ClassTeam.
const FORM_LEVELS = [
  'GRADE_1', 'GRADE_2', 'GRADE_3', 'GRADE_4',
  'GRADE_5', 'GRADE_6', 'GRADE_7',
  'FORM_1', 'FORM_2', 'FORM_3', 'FORM_4', 'FORM_5', 'FORM_6',
  'YEAR_1', 'YEAR_2', 'YEAR_3', 'YEAR_4',
];

const PLAYER_CAP = 18;

const commonFields = {
  school: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  formLevel: {
    type: String,
    enum: FORM_LEVELS,
    required: true,
    index: true,
  },
  captain: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  assistantCaptain: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  players: [{
    type: Schema.Types.ObjectId,
    ref: 'User',
  }],
  active: { type: Boolean, default: true, index: true },
};

const FormTeamSchema = new Schema(commonFields, {
  timestamps: true,
  toJSON: { getters: true },
  toObject: { getters: true },
});
FormTeamSchema.index({ school: 1, formLevel: 1 }, { unique: true });

const ClassTeamSchema = new Schema({
  ...commonFields,
  streamLetter: {
    type: String,
    trim: true,
    required: true,
    maxlength: 4,
  },
}, {
  timestamps: true,
  toJSON: { getters: true },
  toObject: { getters: true },
});
ClassTeamSchema.index(
  { school: 1, formLevel: 1, streamLetter: 1 },
  { unique: true },
);

module.exports.FormTeam = model('FormTeam', FormTeamSchema);
module.exports.ClassTeam = model('ClassTeam', ClassTeamSchema);
module.exports.FORM_LEVELS = FORM_LEVELS;
module.exports.PLAYER_CAP = PLAYER_CAP;
