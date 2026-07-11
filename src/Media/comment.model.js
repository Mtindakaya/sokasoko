const mongoose = require('mongoose');

const { Schema, model } = mongoose;

const CommentSchema = new Schema(
  {
    media: {
      type: Schema.Types.ObjectId,
      ref: 'Media',
      required: true,
      index: true,
    },
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    text: { type: String, required: true, trim: true, maxlength: 1000 },
  },
  { timestamps: true }
);

module.exports = model('Comment', CommentSchema);
