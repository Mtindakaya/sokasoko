const mongoose = require('mongoose');
const actions = require('mongoose-rest-actions');

const { Schema, model } = mongoose;

const VideoSchema = new Schema(
  {
    title: { type: String, required: true },
    description: String,
    link: { type: String, required: true },
    mandatory: { type: Boolean, default: false },
    active: { type: Boolean, default: false },
  },
  {
    id: false,
    timestamps: true,
    toJSON: { getters: true },
    toObject: { getters: true },
    emitIndexErrors: true,
  }
);

VideoSchema.index({
  title: 'text',
});
VideoSchema.pre('save', function preValidate(done) {
  return this.preValidate(done);
});

VideoSchema.methods.preValidate = async function preValidate(done) {
  return done();
};

mongoose.plugin(actions);

module.exports = model('Video', VideoSchema);
