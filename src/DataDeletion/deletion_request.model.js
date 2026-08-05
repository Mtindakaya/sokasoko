const mongoose = require('mongoose');
const { Schema, model } = mongoose;

// A user's request to delete their SokaSoko data, filed either through
// the in-app path or the public web form at /delete-account. Kept as a
// standalone doc so the request survives account deletion (audit +
// Play Store compliance).
const DeletionRequestSchema = new Schema(
  {
    email: { type: String, required: true, trim: true, lowercase: true, index: true },
    accountNumber: { type: String, trim: true, index: true },
    scope: {
      type: String,
      enum: ['ACCOUNT', 'POSTS_MEDIA', 'CHAT_HISTORY', 'OTHER'],
      default: 'ACCOUNT',
    },
    details: { type: String, trim: true, default: '' },
    status: {
      type: String,
      enum: ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'REJECTED'],
      default: 'PENDING',
      index: true,
    },
    source: { type: String, enum: ['WEB', 'IN_APP'], default: 'WEB' },
    handledBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    handledAt: { type: Date, default: null },
    notes: { type: String, trim: true, default: '' },
    ip: { type: String, trim: true, default: '' },
    userAgent: { type: String, trim: true, default: '' },
  },
  { timestamps: true },
);

DeletionRequestSchema.index({ status: 1, createdAt: -1 });

module.exports = model('DeletionRequest', DeletionRequestSchema);
