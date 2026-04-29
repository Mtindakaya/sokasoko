const mongoose = require('mongoose');
const actions = require('mongoose-rest-actions');
const bcrypt = require('bcryptjs');

const { generateHash } = require('../Utils/utils');

const { Schema, model } = mongoose;

const SCHEMA_OPTIONS = {
  id: false,
  timestamps: true,
  toJSON: { getters: true },
  toObject: { getters: true },
  emitIndexErrors: true,
};

const positions = [
  'GOALKEEPER',
  'CENTER BACK',
  'RIGHT BACK',
  'LEFT BACK',
  'WING BACK',
  'OFFENSIVE MIDFIELD',
  'DEFENSIVE MIDFIELD',
  'STRIKER',
  'WINGER',
];

const foot = ['RIGHT', 'LEFT', 'BOTH'];

const types = [
  'PLAYER',
  'COACH',
  'GUARDIAN',
  'ACADEMY',
  'VENDOR',
  'CLUB',
  'SPONSOR',
  'AGENT',
  'REFEREE',
  'SCOUT',
  'FIELD_OWNER',
];

const FREE_TRIAL_DAYS = 60;
const GRACE_PERIOD_DAYS = 5;
const NOTIFY_BEFORE_DAYS = 7;

const UserSchema = new Schema(
  {
    firstName: {
      type: String,
      required: [true, 'firstName is required'],
      searchable: true,
      trim: true,
    },
    middleName: {
      type: String,
      searchable: true,
      trim: true,
    },
    lastName: {
      type: String,
      required: [true, 'lastName is required'],
      searchable: true,
      trim: true,
    },
    accountNumber: {
      type: String,
      trim: true,
      index: true,
      exists: true,
    },
    phone: {
      type: String,
      index: true,
      trim: true,
    },
    region: {
      type: String,
      trim: true,
      index: true,
      searchable: true,
      default: 'Dar es Salaam',
    },
    district: {
      type: String,
      trim: true,
      index: true,
      searchable: true,
      default: 'Ilala Municipal',
    },
    type: { type: String, enum: types, default: types[0] },
    ward: {
      type: String,
      trim: true,
      index: true,
      searchable: true,
      default: 'Ilala',
    },
    dob: {
      type: Date,
      required: false,
      default: null,
    },
    age: { type: Number },
    nationality: {
      type: String,
    },
    gender: {
      type: String,
      index: true,
      searchable: true,
      enum: ['FEMALE', 'MALE'],
    },
    weight: {
      type: Number,
    },
    height: {
      type: Number,
      index: true,
      searchable: true,
    },
    position: {
      type: String,
      trim: true,
      enum: positions,
      index: true,
      searchable: true,
    },
    foot: {
      type: String,
      enum: foot,
      trim: true,
      index: true,
      searchable: true,
    },
    profileImage: {
      type: String,
      default: 'https://sokasoko.s3.us-west-2.amazonaws.com/avatar.png',
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    suspend: { type: Boolean, default: false },
    playlistOverride: { type: Boolean, default: false },
    street: String,
    email: { type: String, trim: true },
    contact_number: { type: String, trim: true },
    facebook: { type: String, trim: true },
    youtube: { type: String, trim: true },
    instagram: { type: String, trim: true },
    twitter: { type: String, trim: true },
    linkedin: { type: String, trim: true },
    website: { type: String, trim: true },
    contact_email: { type: String, trim: true },
    subAccount: { type: Boolean, default: false },
    password: { type: String, required: true },
    fifaId: { type: String, trim: true },
    license_level: { type: String, trim: true },
    education_level: { type: String, trim: true },
    sponsor_type: { type: String, trim: true },
    academy_name: { type: String, trim: true },
    entity_name: { type: String, trim: true },
    company_name: { type: String, trim: true },
    company_title: { type: String, trim: true },
    vendor_type: { type: String, trim: true },
    company_description: { type: String, trim: true },
    academy_registration: { type: String, trim: true },
    coach_registration: { type: String, trim: true },
    coach_license: { type: String, trim: true },
    linkedAcademy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    owner: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    ownerName: { type: String, trim: true },
    secretary: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    secretaryName: { type: String, trim: true },
    academy_description: { type: String, trim: true },
    referee_license_level: { type: String, trim: true },
    tafoca: { type: String, enum: ['YES', 'NO'] },
    talent_id_training: { type: String, enum: ['YES', 'NO'], trim: true },
    national_team_call: { type: Number, default: 0 },
    national_youth_call: { type: Number, default: 0 },
    umiseta_games: { type: String },
    umitashumta_games: { type: String },
    short_bio: { type: String },
    academy: {
      type: Schema.Types.ObjectId,
      ref: 'Academy',
      default: null,
      autopopulate: true,
    },
    agent: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      autopopulate: true,
    },
    advertVideo: {
      type: String,
      default: 'https://www.youtube.com/watch?v=eyGPIpZ7208',
    },
    advertDuration: {
      type: Number,
      default: 5,
    },
    is_mandatory: {
      type: Boolean,
      default: false,
    },

    // --- Free Trial ---
    freeTrialEndDate: {
      type: Date,
      default: null,
      index: true,
    },
    gracePeriodEndDate: {
      type: Date,
      default: null,
      index: true,
    },
    trialExpiredNotifiedAt: {
      type: Date,
      default: null,
    },
    gracePeriodNotifiedAt: {
      type: Date,
      default: null,
    },
  },
  SCHEMA_OPTIONS
);

UserSchema.index({
  firstName: 'text',
  lastName: 'text',
  middleName: 'text',
  accountNumber: 'text',
  academy_name: 'text',
  type: 'text',
  company_name: 'text',
});

// Auto-set free trial dates on first save for PLAYER and SCOUT
UserSchema.pre('save', function preValidate(done) {
  if (this.isNew && (this.type === 'PLAYER' || this.type === 'SCOUT')) {
    const now = new Date();

    const trialEnd = new Date(now);
    trialEnd.setDate(trialEnd.getDate() + FREE_TRIAL_DAYS);
    this.freeTrialEndDate = trialEnd;

    const graceEnd = new Date(trialEnd);
    graceEnd.setDate(graceEnd.getDate() + GRACE_PERIOD_DAYS);
    this.gracePeriodEndDate = graceEnd;
  }
  return this.preValidate(done);
});

UserSchema.methods.preValidate = async function preValidate(done) {
  return done();
};

// Get the current access status of this user
UserSchema.methods.getAccessStatus = function getAccessStatus() {
  const now = new Date();
  const type = this.type;

  // Only PLAYER and SCOUT have trial/subscription restrictions
  if (type !== 'PLAYER' && type !== 'SCOUT') {
    return { status: 'UNRESTRICTED', daysRemaining: null };
  }

  const trialEnd = this.freeTrialEndDate;
  const graceEnd = this.gracePeriodEndDate;

  if (!trialEnd) {
    return { status: 'UNRESTRICTED', daysRemaining: null };
  }

  const msPerDay = 1000 * 60 * 60 * 24;

  // Still in free trial
  if (now <= trialEnd) {
    const daysRemaining = Math.ceil((trialEnd - now) / msPerDay);
    const notifySoon = daysRemaining <= NOTIFY_BEFORE_DAYS;
    return {
      status: 'FREE_TRIAL',
      daysRemaining,
      notifySoon,
      freeTrialEndDate: trialEnd,
      gracePeriodEndDate: graceEnd,
    };
  }

  // In grace period
  if (now <= graceEnd) {
    const daysRemaining = Math.ceil((graceEnd - now) / msPerDay);
    return {
      status: 'GRACE_PERIOD',
      daysRemaining,
      freeTrialEndDate: trialEnd,
      gracePeriodEndDate: graceEnd,
    };
  }

  // Fully expired
  return {
    status: 'EXPIRED',
    daysRemaining: 0,
    freeTrialEndDate: trialEnd,
    gracePeriodEndDate: graceEnd,
  };
};

UserSchema.methods.comparePassword = function comparePassword(password, done) {
  bcrypt.compare(password, this.password, function cb(err, isMatch) {
    if (err) {
      return done(err, false);
    }
    return done(null, isMatch);
  });
};

UserSchema.methods.changePassword = async function changePassword(
  password,
  done
) {
  try {
    this.password = await generateHash(password);
    this.save();
    return done;
  } catch (e) {
    return new Error('Error changing Password');
  }
};

UserSchema.methods.setAccountNumber = function setAccountNumber(
  criteria,
  done
) {
  this.accountNumber = criteria;
  this.save();
  return done;
};

mongoose.plugin(actions);

module.exports = model('User', UserSchema);
module.exports.FREE_TRIAL_DAYS = FREE_TRIAL_DAYS;
module.exports.GRACE_PERIOD_DAYS = GRACE_PERIOD_DAYS;
module.exports.NOTIFY_BEFORE_DAYS = NOTIFY_BEFORE_DAYS;
