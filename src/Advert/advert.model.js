const mongoose = require('mongoose');
const actions = require('mongoose-rest-actions');
const _ = require('lodash');
const { FileTypes } = require('@lykmapipo/file');

const { Schema, model } = mongoose;

const AdvertSchema = new Schema({
  title: { type: String, required: true },
  description: String,
  image: {
    type: Schema.Types.ObjectId,
    ref: FileTypes.File.ref,
    autopopulate: true,
    required: true,
  },
});

AdvertSchema.pre('save', function preValidate(done) {
  return this.preValidate(done);
});

AdvertSchema.methods.preValidate = async function preValidate(done) {
  if (_.isEmpty(this.description)) {
    this.description = this.title;
  }
  return done();
};

mongoose.plugin(actions);

module.exports = model('Advert', AdvertSchema);
