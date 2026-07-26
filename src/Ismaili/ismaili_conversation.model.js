const mongoose = require('mongoose');
const { Schema, model } = mongoose;

// Per-user Ismaili conversation memory. We store the last N turns so we
// don't need to resend the full history to the LLM each turn — the proxy
// route pulls the last 10 messages by createdAt and prepends them.
const IsmailiConversationSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true },
    // When true, the user has consented to this exchange being folded
    // into the AdvisoryEntry knowledge base later.
    consentedForKb: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Compound index for fast "last N turns for user" lookups.
IsmailiConversationSchema.index({ user: 1, createdAt: -1 });

module.exports = model('IsmailiConversation', IsmailiConversationSchema);
