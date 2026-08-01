const mongoose = require('mongoose');
const { Schema, model } = mongoose;

// User-generated reports of other users or their content. Populates the
// moderator review queue.
const ReportSchema = new Schema(
  {
    reporter: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    // The user being reported. Always populated even when the specific
    // artefact (comment, message) is what triggered the report — makes
    // "how often is user X reported" trivial to query.
    reported: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    // What kind of thing is being reported.
    entityType: {
      type: String,
      enum: ['USER', 'POST', 'COMMENT', 'CHAT_MESSAGE', 'ADVISORY'],
      default: 'USER',
      index: true,
    },
    // ObjectId or string id of the specific entity when relevant.
    // Empty when entityType === 'USER' (the whole profile is the target).
    entityId: { type: String, default: '' },

    reason: {
      type: String,
      enum: [
        'SPAM',
        'HARASSMENT',
        'HATEFUL',
        'INAPPROPRIATE',
        'IMPERSONATION',
        'VIOLENCE',
        'OTHER',
      ],
      required: true,
    },
    note: { type: String, trim: true, default: '' },

    status: {
      type: String,
      enum: ['OPEN', 'REVIEWED', 'ACTIONED', 'DISMISSED'],
      default: 'OPEN',
      index: true,
    },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    adminNote: { type: String, default: '' },
  },
  { timestamps: true }
);

ReportSchema.index({ status: 1, createdAt: -1 });
ReportSchema.index({ reported: 1, createdAt: -1 });

module.exports = model('Report', ReportSchema);
