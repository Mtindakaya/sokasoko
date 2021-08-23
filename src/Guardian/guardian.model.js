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

const GuardianSchema = new Schema(
  {
    firstName: {
      type: String,
      required: [true, 'firstName is required'],
      index: true,
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
      index: true,
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
      enum: ['FEMALE', 'MALE'],
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
    type: { type: String, default: 'GUARDIAN' },
    profileImage: {
      type: Schema.Types.ObjectId,
      ref: FileTypes.File.ref,
      autopopulate: true,
    },
    ward: {
      type: String,
      trim: true,
      index: true,
      searchable: true,
      default: 'Ilala',
    },
    password: { type: String, required: true },
  },
  SCHEMA_OPTIONS
);

GuardianSchema.index({ firstName: 'text', lastName: 'text' });

GuardianSchema.pre('validate', function preValidate(done) {
  this.preValidate(done);
});

GuardianSchema.methods.preValidate = async function preValidate(done) {
  try {
    this.password = await generateHash(this.password);
    return done(null, this);
  } catch (error) {
    return done(error);
  }
};

mongoose.plugin(actions);

module.exports = model('Guardian', GuardianSchema);
