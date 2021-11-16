const mongoose = require('mongoose');

const { Schema, model } = mongoose;

const CvSchema = new Schema(
  {
    name: {
      type: String,
      required: [true, 'name is required'],
      trim: true,
    },
    description: {
      type: String,
    },
    isCurrent: { type: Boolean, default: false },
    start_date: {
      type: Date,
      required: true,
    },
    end_date: {
      type: Date,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  {
    id: false,
    timestamps: true,
    toJSON: { getters: true },
    toObject: { getters: true },
    emitIndexErrors: true,
  }
);

module.exports = model('Cv', CvSchema);
