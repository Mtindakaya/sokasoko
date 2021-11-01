const mongoose = require('mongoose');
const actions = require('mongoose-rest-actions');
const { FileTypes } = require('@lykmapipo/file');

const { Schema, model } = mongoose;

const MediaTypes = ['File', 'Link'];

const MediaSchema = new Schema(
  {
    title: { type: String, required: true },
    description: String,
    content: {
      type: Schema.Types.ObjectId,
      ref: FileTypes.File.ref,
      autopopulate: true,
      default: null,
    },
    url: { type: String },
    type: { type: String, required: true, enum: MediaTypes },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  {
    id: false,
    timestamps: true,
    toJSON: { getters: true },
    toObject: { getters: true },
    emitIndexErrors: true,
  }
);

MediaSchema.pre('save', function preValidate(done) {
  return this.preValidate(done);
});

MediaSchema.methods.preValidate = async function preValidate(done) {
  return done();
};

mongoose.plugin(actions);

module.exports = model('Media', MediaSchema);
