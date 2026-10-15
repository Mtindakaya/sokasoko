const mongoose = require('mongoose');

const { Schema, model } = mongoose;

// Org verification request. Submitted from the entity's vCard
// "Hakikisha akaunti" chip. Points at a UserFile the owner already
// uploaded to their private vault (category ORG_REGISTRATION); admin
// reviews it, then flips User.orgVerified via the existing
// POST /v1/users/:id/verified route and marks the request APPROVED
// here for audit.
const VerificationRequestSchema = new Schema({
  org: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  // Caller who submitted the request. The SCHOOL account itself,
  // owner, secretary, or a sports teacher — any staff member we
  // accept on /v1/<kind>-teams/*.
  submittedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  // UserFile ref — the uploaded registration cert. Must exist and
  // belong to the submitter.
  document: {
    type: Schema.Types.ObjectId,
    ref: 'UserFile',
    required: true,
  },
  // Free-text official name the submitter typed on the sheet; often
  // the same as academy_name but may differ (official registration
  // might read "The Mzumbe University" vs the display "Mzumbe").
  officialName: { type: String, trim: true, default: '' },
  status: {
    type: String,
    enum: ['PENDING', 'APPROVED', 'REJECTED'],
    default: 'PENDING',
    index: true,
  },
  reviewedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  reviewedAt: { type: Date, default: null },
  reviewNote: { type: String, trim: true, default: '' },
}, { timestamps: true });

// Keep the newest PENDING per org at hand without a sort. Partial
// unique so a rejected request doesn't block a resubmission.
VerificationRequestSchema.index(
  { org: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: 'PENDING' } },
);

module.exports = model('VerificationRequest', VerificationRequestSchema);
