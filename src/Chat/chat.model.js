const mongoose = require('mongoose');
const { Schema, model } = mongoose;

const MessageSchema = new Schema(
  {
    sender: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    // For 1-to-1 messages — null for group messages
    receiver: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    // For group messages — null for 1-to-1 messages
    group: { type: Schema.Types.ObjectId, ref: 'ChatGroup', default: null },
    content: { type: String, required: true, trim: true },
    // Optional reply — quotes another message that lives in the same conversation
    replyTo: { type: Schema.Types.ObjectId, ref: 'ChatMessage', default: null },
    // Optional forward — original author of the message we're forwarding
    forwardedFrom: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    // Optional shared post — the media being forwarded from someone's profile
    sharedMedia: { type: Schema.Types.ObjectId, ref: 'Media', default: null },
    // 1-to-1 read flag (kept for backwards compatibility)
    read: { type: Boolean, default: false },
    readAt: { type: Date },
    // Group read tracking: array of userIds who have read the message
    readBy: [{ type: Schema.Types.ObjectId, ref: 'User' }],

    // Moderation flags — set at send time when the content matches a
    // profanity/hate wordlist. Message still delivers to the receiver;
    // moderators can filter by flagged=true in the admin CMS.
    flagged: { type: Boolean, default: false, index: true },
    flagReasons: [{ type: String }],
  },
  { timestamps: true }
);

MessageSchema.index({ sender: 1, receiver: 1, createdAt: -1 });
MessageSchema.index({ receiver: 1, read: 1 });
MessageSchema.index({ group: 1, createdAt: -1 });

module.exports = model('ChatMessage', MessageSchema);
