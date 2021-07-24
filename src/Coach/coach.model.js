const mongoose = require('mongoose');

const { Schema, model } = mongoose;

// TODO: Should Add contact info and Created By
const CoachSchema = new Schema({
  firstName: {
    type: String,
    required: [true, 'firstName is required'],
    unique: true,
    trim: true,
    fake: {
      generator: 'name',
      type: 'firstName',
    },
  },
  lastName: {
    type: String,
    required: [true, 'lastName is required'],
    unique: true,
    trim: true,
    fake: {
      generator: 'name',
      type: 'lastName',
    },
  },
  phone: {
    type: String,
    required: true,
    unique: true,
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
  password: { type: String },
});

mongoose.plugin(require('@lykmapipo/mongoose-faker'));

module.exports = model('Coach', CoachSchema);
