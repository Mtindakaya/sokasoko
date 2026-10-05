const mongoose = require('mongoose');
const actions = require('mongoose-rest-actions');
const _ = require('lodash');

const { Schema, model } = mongoose;

const AdvertSchema = new Schema({
  title: { type: String, required: true },
  description: String,
  photo: { type: String },
  adType: { type: String, enum: ['IMAGE', 'VIDEO'], default: 'IMAGE' },
  videoUrl: { type: String },
  link: { type: String },
  // Owner of the advert. VENDOR-only for now — tier gate is enforced in
  // the POST handler against the vendor's concurrent-adverts cap.
  advertiser: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  advertiserName: { type: String },
  // Cached at write time so we can weight feed selection without a
  // per-request Subscription lookup. Snapshot only — the source of truth
  // stays on the Subscription record.
  advertiserTier: {
    type: String,
    enum: ['STANDARD', 'GOLD', 'PLATINUM', 'ENTERPRISE', 'HOUSE'],
  },
  startDate: { type: Date },
  endDate: { type: Date },
  // Targeting axes. Empty array = no restriction at that axis (broadcast).
  // Non-empty = viewer's corresponding attribute must be included.
  // All five axes are AND'd together at sample time.
  targetAudience: { type: [String], default: [] },
  targetGender: { type: [String], default: [] },
  targetRegions: { type: [String], default: [] },
  targetDistricts: { type: [String], default: [] },
  targetWards: { type: [String], default: [] },
  // House ads are created by CMS admin, attributed to the SokaSoko
  // Official user, and bypass vendor tier caps on geo depth / region count.
  isHouseAd: { type: Boolean, default: false, index: true },
  impressionCount: { type: Number, default: 0 },
  clickCount: { type: Number, default: 0 },
}, { timestamps: true });

AdvertSchema.pre('save', function preValidate(done) {
  return this.preValidate(done);
});

AdvertSchema.methods.preValidate = function preValidate(done) {
  if (_.isEmpty(this.description)) {
    this.description = this.title;
  }
  // Any targeting array may arrive as a JSON string from multipart FormData.
  const arrayFields = [
    'targetAudience',
    'targetGender',
    'targetRegions',
    'targetDistricts',
    'targetWards',
  ];
  arrayFields.forEach((field) => {
    if (typeof this[field] === 'string') {
      try {
        this[field] = JSON.parse(this[field]);
      } catch (_) {
        this[field] = [];
      }
    }
  });
  return done();
};

mongoose.plugin(actions);

module.exports = model('Advert', AdvertSchema);
