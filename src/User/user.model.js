const mongoose = require('mongoose');
const actions = require('mongoose-rest-actions');
const bcrypt = require('bcryptjs');
const { FileTypes } = require('@lykmapipo/file');

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
  'OFFENSIVE BACK',
  'DEFENSIVE MIDFIELD',
  'STRIKER',
  'WINGER',
];

const foot = ['RIGHT', 'LEFT', 'BOTH'];

const types = ['PLAYER', 'COACH', 'GUARDIAN'];

const UserSchema = new Schema(
  {
    firstName: {
      type: String,
      required: [true, 'firstName is required'],
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
      unique: true,
      trim: true,
      index: true,
      exists: true,
    },
    phone: {
      type: String,
      required: [true, 'Phone Number already exists'],
      unique: true,
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
      type: Schema.Types.ObjectId,
      ref: FileTypes.File.ref,
      autopopulate: true,
    },
    password: { type: String, required: true },
  },
  SCHEMA_OPTIONS
);

UserSchema.index({ firstName: 'text', lastName: 'text' });

UserSchema.pre('save', function preValidate(done) {
  return this.preValidate(done);
});

UserSchema.methods.preValidate = async function preValidate(done) {
  if (!this.isModified('password')) {
    return done();
  }

  this.password = await generateHash(this.password);

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

mongoose.plugin(actions);

module.exports = model('User', UserSchema);
