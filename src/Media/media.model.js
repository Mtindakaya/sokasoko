const mongoose = require('mongoose');
const actions = require('mongoose-rest-actions');

const { Schema, model } = mongoose;

const MediaTypes = ['Image', 'Link', 'Video'];

const MediaSchema = new Schema(
  {
    title: { type: String, required: true },
    description: String,
    url: { type: String },
    type: { type: String, required: true, enum: MediaTypes },
    order: { type: Number, default: 0 },
    likes: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    commentsCount: { type: Number, default: 0 },
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
    // Feed-boost window. When set and in the future, the /v1/feed
    // sampler surfaces this post ahead of the non-boosted rotation.
    // Consumes one Subscription.promoSlotsUsed on write (see POST
    // /v1/medias/:id/boost). Cleared naturally on expiry — no cron.
    boostedUntil: { type: Date, default: null, index: true },
    // Cached native video dimensions — populated by the client's JS
    // probe the first time anyone plays this clip. Subsequent viewers
    // read these fields off the initial playlist response and skip
    // the probe entirely, so the challenge frame renders at the
    // correct aspect from the first paint (no dark-rectangle load-in
    // animation for known clips).
    videoWidth: { type: Number, default: 0 },
    videoHeight: { type: Number, default: 0 },
    // Shindano — when set, this Media is the player's submission for a
    // specific Playlist-with-brief challenge. Enforced 1-per-player via
    // the sparse unique compound index below. Populated on create and
    // never mutated (submission is one-shot).
    challenge: {
      type: Schema.Types.ObjectId,
      ref: 'Playlist',
      default: null,
      index: true,
    },
    challengeSubmittedAt: { type: Date, default: null },
    // Podium — denormalized from Playlist.winner/runnersUp during
    // POST /v1/challenges/:id/close-voting. Kept here so any Media
    // tile (profile carousel, feed, search) can render the winner
    // badge without joining Playlist. podiumRank: 1=🥇, 2=🥈, 3=🥉.
    wonChallenge: {
      type: Schema.Types.ObjectId,
      ref: 'Playlist',
      default: null,
      index: true,
    },
    podiumRank: { type: Number, default: 0, min: 0, max: 3 },
    wonAt: { type: Date, default: null },
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

// Compound index tuned for the hot query path: profile pane + MyFiles
// both filter by createdBy and order by (order asc, createdAt asc).
MediaSchema.index({ createdBy: 1, order: 1, createdAt: 1 });
MediaSchema.index({ player: 1 });
// One submission per player per challenge. Sparse so non-challenge
// Media (99% of rows) doesn't collide on {player:null, challenge:null}.
MediaSchema.index(
  { player: 1, challenge: 1 },
  {
    unique: true,
    partialFilterExpression: { challenge: { $type: 'objectId' } },
  },
);

MediaSchema.pre('save', function preValidate(done) {
  return this.preValidate(done);
});

MediaSchema.methods.preValidate = async function preValidate(done) {
  return done();
};

mongoose.plugin(actions);

module.exports = model('Media', MediaSchema);
