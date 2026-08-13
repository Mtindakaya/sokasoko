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
    enum: ['STANDARD', 'GOLD', 'PLATINUM', 'ENTERPRISE'],
  },
  startDate: { type: Date },
  endDate: { type: Date },
  targetAudience: { type: [String], default: [] },
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
  // targetAudience may arrive as a JSON string from multipart FormData
  if (typeof this.targetAudience === 'string') {
    try {
      this.targetAudience = JSON.parse(this.targetAudience);
    } catch (_) {
      this.targetAudience = [];
    }
  }
  return done();
};

mongoose.plugin(actions);

module.exports = model('Advert', AdvertSchema);
