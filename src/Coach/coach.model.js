const mongoose = require('mongoose');
const actions = require('mongoose-rest-actions');
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

const CoachSchema = new Schema(
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
      type: String,
      unique: true,
      trim: true,
      index: true,
    },
    phone: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
      fake: {
        generator: 'phone',
        type: 'phoneNumber',
      },
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
    type: { type: String, default: 'COACH' },
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
      enum: ['FEMALE', 'MALE'],
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

CoachSchema.index({ firstName: 'text', lastName: 'text' });

CoachSchema.pre('validate', function preValidate(done) {
  this.preValidate(done);
});

CoachSchema.methods.preValidate = async function preValidate(done) {
  try {
    this.password = await generateHash(this.password);
    return done(null, this);
  } catch (error) {
    return done(error);
  }
};

mongoose.plugin(actions);

module.exports = model('Coach', CoachSchema);
