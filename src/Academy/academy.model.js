const mongoose = require('mongoose');

const { Schema, model } = mongoose;

// TODO: Should Add contact info and Created By
const AcademySchema = new Schema({
  name: {
    type: String,
    required: [true, 'name is required'],
    unique: true,
    trim: true,
    fake: {
      generator: 'company',
      type: 'companyName',
    },
  },
  registrationNumber: {
    type: String,
    unique: true,
    trim: true,
  },
  isTafoca: {
    type: Boolean,
    default: false,
  },
  accountNumber: {
    type: Number,
    unique: true,
    trim: true,
    index: true,
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
  bio: {
    type: String,
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
  password: { type: String },
});

mongoose.plugin(require('@lykmapipo/mongoose-faker'));

module.exports = model('Academy', AcademySchema);
