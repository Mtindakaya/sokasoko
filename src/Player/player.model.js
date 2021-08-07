const mongoose = require('mongoose');
const actions = require('mongoose-rest-actions');
const Counter = require('../Counter/counter.model');
const { generateHash } = require('../Utils/utils');

const { Schema, model } = mongoose;

mongoose.plugin(actions);

const SCHEMA_OPTIONS = {
  id: false,
  timestamps: false,
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

const PlayerSchema = new Schema(
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
      type: Number,
      unique: true,
      trim: true,
      index: true,
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
    age: { type: Number, required: true },
    nationality: {
      type: String,
    },
    gender: {
      type: String,
      index: true,
      searchable: true,
      enum: ['F', 'M'],
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
    profileImage: { type: String },
    password: { type: String, required: true },
  },
  SCHEMA_OPTIONS
);

PlayerSchema.index({ firstName: 'text', lastName: 'text' });

PlayerSchema.pre('validate', function preValidate(done) {
  this.preValidate(done);
});

PlayerSchema.methods.preValidate = async function preValidate(done) {
  try {
    this.accountNumber = await Counter.getNextSequenceValue('memberId');
    this.password = await generateHash(this.password);
    return done(null, this);
  } catch (error) {
    return done(error);
  }
};

module.exports = model('Player', PlayerSchema);
