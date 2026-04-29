const mongoose = require('mongoose');
const { Schema, model } = mongoose;

const ProfileViewModel = new Schema(
  {
    profile: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    viewer: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    viewerType: {
      type: String,
      default: null,
    },
    viewedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  { timestamps: false }
);

module.exports = model('ProfileView', ProfileViewModel);
