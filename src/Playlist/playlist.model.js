const mongoose = require('mongoose');
const actions = require('mongoose-rest-actions');

const { Schema, model } = mongoose;

const PlaylistSchema = new Schema(
  {
    title: { type: String, required: true },
    description: { type: String, default: '' },
    videos: [
      {
        type: Schema.Types.ObjectId,
        ref: 'Media',
        required: true,
        autopopulate: true,
      },
    ],
    isActive: { type: Boolean, default: false },
    globalOverride: { type: Boolean, default: false },
    votingEnabled: { type: Boolean, default: false },
    scheduledSessions: [
      {
        startTime: { type: String, required: true }, // "HH:MM" 24-hour
        durationMinutes: { type: Number, required: true },
        days: [{ type: String, enum: ['mon','tue','wed','thu','fri','sat','sun'] }], // empty = every day
      }
    ],
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
