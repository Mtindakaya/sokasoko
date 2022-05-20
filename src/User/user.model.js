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
];

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
      required: true,
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
    street: String,
    email: { type: String, trim: true },
    contact_number: { type: String, trim: true },
    facebook: { type: String, trim: true },
    youtube: { type: String, trim: true },
    instagram: { type: String, trim: true },
    twitter: { type: String, trim: true },
    linkedin: { type: String, trim: true },
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
    academy_description: { type: String, trim: true },
    referee_license_level: { type: String, trim: true },
    tafoca: { type: String, enum: ['YES', 'NO'] },
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
      // default: 'https://www.youtube.com/watch?v=ui3bUGnNPqw',
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

UserSchema.pre('save', function preValidate(done) {
  return this.preValidate(done);
});

UserSchema.methods.preValidate = async function preValidate(done) {
  return done();
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
