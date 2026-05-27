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
  advertiserName: { type: String },
  startDate: { type: Date },
  endDate: { type: Date },
  targetAudience: { type: [String], default: [] },
  impressionCount: { type: Number, default: 0 },
  clickCount: { type: Number, default: 0 },
});

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
