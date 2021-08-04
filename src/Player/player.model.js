const mongoose = require('mongoose');
const actions = require('mongoose-rest-actions');

const { Schema, model } = mongoose;

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
      trim: true,
      fake: {
        generator: 'name',
        type: 'firstName',
      },
    },
    lastName: {
      type: String,
      required: [true, 'lastName is required'],
      trim: true,
      fake: {
        generator: 'name',
        type: 'lastName',
      },
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
      fake: {
        generator: 'phone',
        type: 'phoneNumber',
      },
    },
    location: {
      type: String,
      trim: true,
      index: true,
      searchable: true,
      fake: {
        generator: 'address',
        type: 'streetAddress',
      },
    },
    dob: {
      type: Date,
      required: true,
      fake: {
        generator: 'datatype',
        type: 'datetime',
      },
    },
    nationality: {
      type: String,
      fake: {
        generator: 'address',
        type: 'country',
      },
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
    password: { type: String },
  },
  SCHEMA_OPTIONS
);

PlayerSchema.index({ firstName: 'text', lastName: 'text' });

PlayerSchema.pre('validate', function cb(next) {
  next();
});

mongoose.plugin(actions, require('@lykmapipo/mongoose-faker'));

module.exports = model('Player', PlayerSchema);
