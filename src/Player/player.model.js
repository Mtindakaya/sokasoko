const mongoose = require('mongoose');

const { Schema, model } = mongoose;

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

const PlayerSchema = new Schema({
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
});

mongoose.plugin(require('@lykmapipo/mongoose-faker'));

module.exports = model('Player', PlayerSchema);
