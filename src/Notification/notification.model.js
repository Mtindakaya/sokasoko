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

// Guardian fan-out: any notification created for a minor with a linked
// guardian mirrors to the guardian too, so they see everything the
// child sees. See project_guardian_minor_relationship memory (Rule 1).
// The mirrored copy carries metadata.mirrored=true so the hook is a
// no-op on the second pass (loop guard, cheap).
NotificationSchema.post('save', async function (doc) {
  if (doc.metadata && doc.metadata.mirrored) return;
  try {
    const User = mongoose.model('User');
    const user = await User.findById(doc.userId)
      .select('guardian guardianOrphaned firstName')
      .lean();
    if (!user || !user.guardian || user.guardianOrphaned) return;
    const minorName = (user.firstName || 'Mtoto').trim();
    await doc.constructor.create({
      userId: user.guardian,
      type: doc.type,
      title: `${minorName}: ${doc.title}`,
      body: doc.body,
      metadata: {
        ...(doc.metadata || {}),
        mirrored: true,
        originalUserId: doc.userId,
        originalNotificationId: doc._id,
      },
    });
  } catch (err) {
    console.error('[notification.fanout] failed for doc', String(doc._id), '—', err.message);
  }
});

module.exports = model('Notification', NotificationSchema);
