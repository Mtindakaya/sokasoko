const mongoose = require('mongoose');
const actions = require('mongoose-rest-actions');

const { Schema, model } = mongoose;

const MediaTypes = ['Image', 'Link'];

const MediaSchema = new Schema(
  {
    title: { type: String, required: true },
    description: String,
    url: { type: String },
    type: { type: String, required: true, enum: MediaTypes },
    order: { type: Number, default: 0 },
    likes: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    votes: [{
      userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
      score: { type: Number, min: 0, max: 10, required: true },
    }],
    player: { type: Schema.Types.ObjectId, ref: 'User', required: false },
    isPlaylist: { type: Boolean, default: false },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: false,
      autopopulate: true,
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

MediaSchema.index({
  title: 'text',
});

MediaSchema.pre('save', function preValidate(done) {
  return this.preValidate(done);
});

MediaSchema.methods.preValidate = async function preValidate(done) {
  return done();
};

mongoose.plugin(actions);

module.exports = model('Media', MediaSchema);
