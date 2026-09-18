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
    // Non-challenge playlists (announcements) prepend a single item to
    // the profile carousel. When mandatoryView is true the client hides
    // the SKIP button so the viewer must play through. Only meaningful
    // when votingEnabled is false and videos.length === 1 — the /activate
    // endpoint enforces the single-item rule for non-challenge playlists.
    mandatoryView: { type: Boolean, default: false },
    // The default playlist is the ultimate fallback content pool — it
    // plays when a viewer has no personal media AND no audience-matched
    // active playlist. Only ONE playlist can be default at a time
    // (set-default endpoint enforces uniqueness). Independent of
    // isActive: admin curates it once and it's always available.
    isDefaultPlaylist: { type: Boolean, default: false },
    // Optional sponsor for the challenge — a User of type SPONSOR (or
    // any Platinum/Enterprise account that runs a challenge). When
    // present, the client renders logo + name on the challenge banner
    // and taps route to the sponsor's profile.
    sponsor: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    // Hex color (e.g. "#FF6B00") — a Platinum/Enterprise sponsor perk.
    // Server rejects writes when the sponsor's effective tier is below
    // PLATINUM, so a client that bypasses the UI can't set this. Empty
    // string means "use the default blue gradient."
    sponsorBrandColor: { type: String, trim: true, default: '' },
    // Which User types this playlist targets. Empty array = broadcast
    // (every user type sees it). Non-empty = only those types.
    // Audience-scoped playlists can coexist with the broadcast; on
    // GET /active, audience-specific wins over broadcast for a given
    // caller.
    targetAudiences: [{
      type: String,
      enum: [
        'PLAYER', 'COACH', 'GUARDIAN', 'ACADEMY', 'SCHOOL', 'VENDOR',
        'CLUB', 'SPONSOR', 'AGENT', 'REFEREE', 'SCOUT', 'FIELD_OWNER',
      ],
    }],
    scheduledSessions: [
      {
        startTime: { type: String, required: true }, // "HH:MM" 24-hour
        durationMinutes: { type: Number, required: true },
        days: [{ type: String, enum: ['mon','tue','wed','thu','fri','sat','sun'] }], // empty = every day
      }
    ],
    // Admin-created preamble that runs BEFORE the challenge opens for
    // submissions. Either `video` or `instructions` must be present.
    // While `expiresAt > now`, submissions are blocked and the brief is
    // shown on Home + intermittently in the user-account carousel.
    brief: {
      video: { type: Schema.Types.ObjectId, ref: 'Media', default: null },
      instructions: { type: String, trim: true, default: '' },
      createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
      // 'SOKASOKO' = admin-initiated. 'RECOMMENDATION' = admin promoted
      // a Platinum user's recommendation (Phase 2 intake).
      source: {
        type: String,
        enum: ['SOKASOKO', 'RECOMMENDATION'],
        default: 'SOKASOKO',
      },
      recommendedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
      publishedAt: { type: Date, default: null },
      expiresAt: { type: Date, default: null },
      showOnHome: { type: Boolean, default: true },
      // 1 = roughly every 5th carousel slot. 0 hides from carousel.
      carouselWeight: { type: Number, default: 1, min: 0, max: 5 },
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
