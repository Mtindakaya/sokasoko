const mongoose = require('mongoose');

const { Schema, model } = mongoose;

// One row per (userId, token). A single user can hold multiple tokens
// (phone + tablet + reinstalls). Tokens auto-refresh client-side; the
// register endpoint upserts by token so duplicates are impossible.
const DeviceTokenSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    token: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    platform: {
      type: String,
      enum: ['android', 'ios', 'web'],
      required: true,
    },
    appVersion: { type: String, default: '' },
    lastSeenAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true },
);

module.exports = model('DeviceToken', DeviceTokenSchema);
