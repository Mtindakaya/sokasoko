const mongoose = require('mongoose');
const actions = require('mongoose-rest-actions');
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

mongoose.plugin(actions);

module.exports = model('Advert', AdvertSchema);
