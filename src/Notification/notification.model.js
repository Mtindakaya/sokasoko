const mongoose = require('mongoose');
const { Schema, model } = mongoose;

const NotificationSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true },
    body: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: ['PROGRESS_REPORT', 'SYSTEM', 'PAYMENT', 'REPORT_READY'],
      default: 'SYSTEM',
    },
    read: { type: Boolean, default: false, index: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, toJSON: { getters: true }, toObject: { getters: true } }
);

// Hot query path is "my notifications, newest first" and "how many
// unread". Compound index services both without a full-collection scan.
NotificationSchema.index({ userId: 1, createdAt: -1 });
NotificationSchema.index({ userId: 1, read: 1 });

module.exports = model('Notification', NotificationSchema);
