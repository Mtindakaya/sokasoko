const mongoose = require('mongoose');
const actions = require('mongoose-rest-actions');

const { Schema, model } = mongoose;

// General-purpose invitation collection. Currently used for
// SCHOOL_LINK + AGENT_LINK; ACADEMY_ROSTER lives on the Academy
// collection for legacy reasons but the pattern is the same. Add
// new kinds here as more actor-triggered associations move to
// requiring player verification.
const KINDS = ['SCHOOL_LINK', 'AGENT_LINK'];
const STATUSES = ['PENDING', 'VERIFIED', 'REJECTED'];

const InvitationSchema = new Schema(
  {
    invitee: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    inviter: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    kind: {
      type: String,
      enum: KINDS,
      required: true,
      index: true,
    },
    // Freeform per-kind data:
    //   SCHOOL_LINK: { school_class?, school_jersey_number? }
    //   AGENT_LINK:  {}
    payload: { type: Schema.Types.Mixed, default: {} },
    status: {
      type: String,
      enum: STATUSES,
      default: 'PENDING',
      index: true,
    },
    verifiedAt: { type: Date, default: null },
    rejectedAt: { type: Date, default: null },
    rejectReason: { type: String, trim: true, default: '' },
  },
  {
    id: false,
    timestamps: true,
    toJSON: { getters: true },
    toObject: { getters: true },
    emitIndexErrors: true,
  }
);

// Hot query: "invitations awaiting this player's decision".
InvitationSchema.index({ invitee: 1, status: 1, createdAt: -1 });

mongoose.plugin(actions);

module.exports = model('Invitation', InvitationSchema);
module.exports.KINDS = KINDS;
module.exports.STATUSES = STATUSES;
