const mongoose = require('mongoose');

const { Schema, model } = mongoose;

const CvSchema = new Schema(
  {
    name: {
      type: String,
      required: [true, 'name is required'],
      trim: true,
    },
    isCurrent: { type: Boolean, default: false },
    person: { type: String },
    type: { type: String, enum: ['Manager', 'Coach'] },
    phone: String,
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
