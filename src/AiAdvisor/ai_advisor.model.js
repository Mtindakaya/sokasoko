const mongoose = require('mongoose');
const { Schema, model } = mongoose;

const AiQuerySchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    question: { type: String, required: true, trim: true },
    answer: { type: String, trim: true },
    tokensUsed: { type: Number, default: 0 },
    context: { type: String, trim: true }, // optional: 'report', 'profile', etc.
    status: { type: String, enum: ['pending', 'answered', 'error'], default: 'pending' },
  },
  { timestamps: true }
);

AiQuerySchema.index({ userId: 1, createdAt: -1 });

module.exports = model('AiQuery', AiQuerySchema);
