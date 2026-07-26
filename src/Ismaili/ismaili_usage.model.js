const mongoose = require('mongoose');
const { Schema, model } = mongoose;

// Sliding-window rate limiter. One row per user per hour bucket.
const IsmailiUsageSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // YYYY-MM-DDTHH bucket key so a single upsert with $inc is enough.
    hourKey: { type: String, required: true, index: true },
    // YYYY-MM-DD bucket key for the daily cap.
    dayKey: { type: String, required: true, index: true },
    count: { type: Number, default: 0 },
    dayCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

IsmailiUsageSchema.index({ user: 1, hourKey: 1 }, { unique: true });

module.exports = model('IsmailiUsage', IsmailiUsageSchema);
