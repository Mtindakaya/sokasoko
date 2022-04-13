const mongoose = require('mongoose');
const actions = require('mongoose-rest-actions');

const { Schema, model } = mongoose;

const PlaylistSchema = new Schema(
  {
    title: { type: String, required: true },
    videos: [
      {
        type: Schema.Types.ObjectId,
        ref: 'Media',
        required: true,
        autopopulate: true,
      },
    ],
    isActive: { type: Boolean, default: false },
  },
  {
    id: false,
    timestamps: true,
    toJSON: { getters: true },
    toObject: { getters: true },
    emitIndexErrors: true,
  }
);

PlaylistSchema.index({
  title: 'text',
});

PlaylistSchema.pre('save', function preValidate(done) {
  return this.preValidate(done);
});

PlaylistSchema.methods.preValidate = async function preValidate(done) {
  return done();
};

mongoose.plugin(actions);

module.exports = model('Playlist', PlaylistSchema);
