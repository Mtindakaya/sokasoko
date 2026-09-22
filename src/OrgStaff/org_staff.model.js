const mongoose = require('mongoose');
const actions = require('mongoose-rest-actions');

const { Schema, model } = mongoose;

// Roles carry different delegated privileges. See docs (or the enforcement
// helper in Subscription.model) for the exact permission mapping.
//   - OWNER   : full delegated org powers (Academy/Club)
//   - MANAGER : full delegated org powers (Academy/Club)
//   - COACH   : full delegated org powers (Academy/Club)
//   - OTHER   : chat only — no elevated powers. `customRoleTitle` may
//               carry a user-typed job title for display.
//   - SPORTS_TEACHER : COACH-GOLD equivalent (School only)
//   - CHAIRPERSON / SECRETARY / ACCOUNTANT : governance roles for
//     Football Associations (Mwenyekiti / Katibu / Mweka Hazina).
//     Chat + view roster; no elevated tier privileges.
const ROLES = [
  'OWNER', 'MANAGER', 'COACH', 'OTHER', 'SPORTS_TEACHER',
  'CHAIRPERSON', 'SECRETARY', 'ACCOUNTANT',
];
const STATUSES = ['PENDING', 'ACTIVE', 'DECLINED', 'DISABLED'];

const OrgStaffLinkSchema = new Schema(
  {
    org:   { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    staff: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    role:  { type: String, enum: ROLES, required: true },
    // Free-text job title used when role === 'OTHER' — lets orgs add
    // any position (e.g. Msajili wa Klabu, Msemaji, Mkurugenzi). UI
    // shows this string in the role slot when set; otherwise falls
    // back to the localized ROLES label.
    customRoleTitle: { type: String, trim: true, default: null },
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

// FA notification: when a staff link goes ACTIVE (staff accepted the
// invite), let the FAs in the org's district know about the change.
// Fires once per acceptance via acceptedAt idempotency in the caller.
OrgStaffLinkSchema.post('save', async function faStaffChange(doc) {
  try {
    if (doc.status !== 'ACTIVE') return;
    // Only fire on the accept transition — acceptedAt just got set and
    // the doc is fresh enough that we can use $wasNew || isModified.
    // Post('save') doesn't expose isModified; rely on acceptedAt being
    // newly set (within the last 60s) to avoid re-firing on subsequent
    // updates that don't change link status.
    if (!doc.acceptedAt) return;
    const ageMs = Date.now() - new Date(doc.acceptedAt).getTime();
    if (ageMs > 60_000) return;
    const { notifyFaOfStaffChange } = require('../FootballAssociation/fa_notifier');
    await notifyFaOfStaffChange(doc);
  } catch (err) {
    console.log('[org_staff.post-save fa notify] failed:', err.message);
  }
});

mongoose.plugin(actions);

module.exports = model('OrgStaffLink', OrgStaffLinkSchema);
module.exports.ROLES = ROLES;
module.exports.STATUSES = STATUSES;
