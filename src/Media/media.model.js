const mongoose = require('mongoose');
const actions = require('mongoose-rest-actions');

const { Schema, model } = mongoose;

const MediaSchema = new Schema(
  {
    title: { type: String, required: true },
    description: String,
    content: { type: String, required: true },
    type: { type: String, required: true },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      autopopulate: true,
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
