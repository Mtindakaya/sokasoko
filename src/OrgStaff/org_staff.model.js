const mongoose = require('mongoose');
const actions = require('mongoose-rest-actions');

const { Schema, model } = mongoose;

// Roles carry different delegated privileges. See docs (or the enforcement
// helper in Subscription.model) for the exact permission mapping.
//   - OWNER   : full delegated org powers (Academy/Club)
//   - MANAGER : full delegated org powers (Academy/Club)
//   - COACH   : full delegated org powers (Academy/Club)
//   - OTHER   : chat only — no elevated powers
//   - SPORTS_TEACHER : COACH-GOLD equivalent (School only)
const ROLES = ['OWNER', 'MANAGER', 'COACH', 'OTHER', 'SPORTS_TEACHER'];
const STATUSES = ['PENDING', 'ACTIVE', 'DECLINED', 'DISABLED'];

const OrgStaffLinkSchema = new Schema(
  {
    org:   { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    staff: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    role:  { type: String, enum: ROLES, required: true },
    status: { type: String, enum: STATUSES, default: 'PENDING', index: true },
    invitedBy:  { type: Schema.Types.ObjectId, ref: 'User', default: null },
    invitedAt:  { type: Date, default: Date.now },
    acceptedAt: { type: Date, default: null },
    disabledAt: { type: Date, default: null },
    // e.g. "Org downgraded to Gold; over 3-seat quota" or "Owner removed"
    disabledReason: { type: String, default: null },
  },
  { timestamps: true }
);

// One-to-one enforcement: a guardian can be ACTIVE staff at only one org.
// Partial index so PENDING invitations from other orgs don't collide.
OrgStaffLinkSchema.index(
  { staff: 1 },
  { unique: true, partialFilterExpression: { status: 'ACTIVE' } }
);
// A guardian can hold at most one PENDING invite per org (dedupe re-invites).
OrgStaffLinkSchema.index(
  { staff: 1, org: 1 },
  { unique: true, partialFilterExpression: { status: 'PENDING' } }
);

mongoose.plugin(actions);

module.exports = model('OrgStaffLink', OrgStaffLinkSchema);
module.exports.ROLES = ROLES;
module.exports.STATUSES = STATUSES;
