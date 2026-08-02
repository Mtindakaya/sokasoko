const mongoose = require('mongoose');
const { Schema, model } = mongoose;

// A minor's request to attach to a specific guardian. Kept as its own
// collection (not an inline array on User) so history + audit trail
// survive an accept/decline.
const GuardianRequestSchema = new Schema(
  {
    minor: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    guardian: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED'],
      default: 'PENDING',
      index: true,
    },
    respondedAt: { type: Date, default: null },
    note: { type: String, default: '', trim: true },
  },
  { timestamps: true }
);

// A minor can only have one PENDING request at a time — enforced by the
// endpoint (cancel prior PENDING before creating a new one).
GuardianRequestSchema.index({ minor: 1, status: 1 });
GuardianRequestSchema.index({ guardian: 1, status: 1, createdAt: -1 });

module.exports = model('GuardianRequest', GuardianRequestSchema);
