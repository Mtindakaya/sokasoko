const mongoose = require('mongoose');

const { Schema, model } = mongoose;

const teamSchema = new Schema(
  {
    name: { type: String, required: true },
    person: { type: String },
    type: { type: String, enum: ['Manager', 'Coach'] },
    phone: String,
  },
  {
    id: false,
    timestamps: true,
    toJSON: { getters: true },
    toObject: { getters: true },
    emitIndexErrors: true,
  }
);

teamSchema.index({ name: 'text', type: 'text' });

module.exports = model('Team', teamSchema);
