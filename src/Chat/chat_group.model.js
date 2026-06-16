const mongoose = require('mongoose');
const { Schema, model } = mongoose;

const ChatGroupSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    members: [{ type: Schema.Types.ObjectId, ref: 'User', required: true }],
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    avatar: { type: String },
    description: { type: String, trim: true },
  },
  { timestamps: true }
);

ChatGroupSchema.index({ members: 1 });

module.exports = model('ChatGroup', ChatGroupSchema);
