const mongoose = require('mongoose');

const { Schema, model } = mongoose;

// One row per advert surfaced to one viewer on one surface. Written
// from the feed sampler + the profile-carousel endpoint so vendors
// can later see where their reach is going. Kept intentionally thin
// — richer analytics (unique viewers, click-through) are derived.
const AdvertImpressionSchema = new Schema({
  advert: { type: Schema.Types.ObjectId, ref: 'Advert', index: true, required: true },
  viewer: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  surface: { type: String, enum: ['FEED', 'CAROUSEL'], required: true, index: true },
  shownAt: { type: Date, default: Date.now, index: true },
}, { timestamps: false });

module.exports = model('AdvertImpression', AdvertImpressionSchema);
