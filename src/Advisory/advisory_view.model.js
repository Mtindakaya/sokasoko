const mongoose = require('mongoose');

const { Schema, model } = mongoose;

// One row per time a logged-in user opens the full-detail sheet for an
// approved advisory on the public tab. The denormalised viewCount on
// AdvisoryEntry is the user-visible metric; this collection is the raw
// log used for compensation accounting + the data-sovereignty research
// track (joins back to the User to enrich with the viewer's own
// demographics at query time).
//
// We intentionally do NOT snapshot viewer demographics here — the user
// account is the source of truth and can be joined on demand. This keeps
// the row small (two ObjectIds + a timestamp) and the collection cheap
// to maintain.
const AdvisoryViewSchema = new Schema(
  {
    advisory: {
      type: Schema.Types.ObjectId,
      ref: 'AdvisoryEntry',
      required: true,
      index: true,
    },
    viewer: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    at: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false }
);

// Fast aggregation on (advisory → distinct viewers) and (viewer → list).
AdvisoryViewSchema.index({ advisory: 1, at: -1 });
AdvisoryViewSchema.index({ viewer: 1, at: -1 });

module.exports = model('AdvisoryView', AdvisoryViewSchema);
