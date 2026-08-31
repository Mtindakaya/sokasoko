const express = require('express');
const { getString } = require('@lykmapipo/env');
const OrgStaffLink = require('./org_staff.model');
const User = require('../User/user.model');
const Notification = require('../Notification/notification.model');
const { Subscription, FEATURE_CAPS } = require('../Subscription/subscription.model');

const API_VERSION = getString('API_VERSION', '1.0.0');
const router = express.Router();
const BASE = `/v${API_VERSION.split('.')[0]}`;

// Roles that carry FULL delegated org powers (only for Academy/Club).
const FULL_POWER_ROLES = ['OWNER', 'MANAGER', 'COACH'];
// Singleton roles — an org may have at most one holder each (ACTIVE or
// PENDING count toward the check so we don't stack duplicate invites).
// CHAIRPERSON / SECRETARY / ACCOUNTANT are governance roles for FA
// orgs — one per org each. OTHER stays multi-instance (many "other"
// staff can coexist with different customRoleTitles).
const SINGLETON_ROLES = ['OWNER', 'MANAGER', 'COACH',
  'CHAIRPERSON', 'SECRETARY', 'ACCOUNTANT'];

// Look up the org's staff cap for its current effective tier. SCHOOL has
// a fixed FREE tier since it isn't subscription-eligible.
async function orgStaffCap(orgId, orgType) {
  if (orgType === 'SCHOOL') {
    return FEATURE_CAPS.SCHOOL?.FREE?.staffSeats || 0;
  }
  const tier = await Subscription.getEffectiveTier(orgId, orgType);
  const caps = FEATURE_CAPS[orgType]?.[tier] || {};
  return caps.staffSeats || 0;
}

// POST /v1/users/:orgId/staff/invite  body: { guardianId, role }
router.post(`${BASE}/users/:orgId/staff/invite`, async (req, res) => {
  try {
    const orgId = req.params.orgId;
    const { guardianId, role } = req.body;
    if (!guardianId || !role) {
      return res.status(400).json({ error: 'guardianId and role are required' });
    }
    if (!OrgStaffLink.ROLES.includes(role)) {
      return res.status(400).json({ error: 'invalid role' });
    }

    const [org, guardian] = await Promise.all([
      User.findById(orgId).select('type firstName lastName academy_name').lean(),
      User.findById(guardianId).select('type firstName lastName').lean(),
    ]);
    if (!org) return res.status(404).json({ error: 'org not found' });
    if (!guardian) return res.status(404).json({ error: 'guardian not found' });

    if (!['ACADEMY', 'CLUB', 'SCHOOL', 'FOOTBALL_ASSOCIATION'].includes(org.type)) {
      return res.status(400).json({ error: 'org must be ACADEMY, CLUB, SCHOOL or FOOTBALL_ASSOCIATION' });
    }
    if (guardian.type !== 'GUARDIAN') {
      return res.status(400).json({ error: 'staff must currently be a GUARDIAN account' });
    }

    // Role restrictions per org type.
    if (org.type === 'SCHOOL' && role !== 'SPORTS_TEACHER') {
      return res.status(400).json({ error: 'SCHOOL can only invite SPORTS_TEACHER role' });
    }
    if (['ACADEMY', 'CLUB', 'FOOTBALL_ASSOCIATION'].includes(org.type) && role === 'SPORTS_TEACHER') {
      return res.status(400).json({ error: 'SPORTS_TEACHER is a SCHOOL role only' });
    }
    // CHAIRPERSON / SECRETARY / ACCOUNTANT are FA governance roles;
    // reject if ACADEMY / CLUB try to use them (avoid confusion with
    // their existing OWNER/MANAGER/COACH taxonomy).
    if (['ACADEMY', 'CLUB', 'SCHOOL'].includes(org.type) &&
        ['CHAIRPERSON', 'SECRETARY', 'ACCOUNTANT'].includes(role)) {
      return res.status(400).json({
        error: 'CHAIRPERSON / SECRETARY / ACCOUNTANT are FOOTBALL_ASSOCIATION roles',
      });
    }
    // FA orgs don't use the OWNER / MANAGER / COACH shape — those
    // roles map to Academy/Club leadership and would confuse the
    // governance taxonomy. Reject them here so the client can't
    // send stale values from an older build.
    if (org.type === 'FOOTBALL_ASSOCIATION' &&
        ['OWNER', 'MANAGER', 'COACH'].includes(role)) {
      return res.status(400).json({
        error: 'FOOTBALL_ASSOCIATION orgs use CHAIRPERSON / SECRETARY / ACCOUNTANT / OTHER',
      });
    }

    // Seat cap check — count ACTIVE + PENDING toward the quota so an org
    // can't over-invite past their seats even before acceptance.
    const cap = await orgStaffCap(orgId, org.type);
    if (cap === 0) {
      return res.status(403).json({
        error: `Kifurushi cha sasa hakiruhusu wafanyakazi wa ziada. Boresha kifurushi.`,
        reason: 'STAFF_SEATS_ZERO',
      });
    }
    const inFlight = await OrgStaffLink.countDocuments({
      org: orgId, status: { $in: ['ACTIVE', 'PENDING'] },
    });
    if (inFlight >= cap) {
      return res.status(403).json({
        error: `Umefikia kikomo cha wafanyakazi ${cap}. Ondoa mtu au boresha kifurushi.`,
        reason: 'STAFF_SEATS_FULL', cap, current: inFlight,
      });
    }

    // Per-role cap for OTHER on FA orgs — governance singletons are
    // caught by SINGLETON_ROLES below; OTHER is normally unlimited so
    // needs this extra guard. Bounded by FEATURE_CAPS.<type>.<tier>
    // .maxOtherStaff when set.
    if (role === 'OTHER') {
      const tierForCap = await Subscription.getEffectiveTier(orgId, org.type);
      const capsForType = FEATURE_CAPS[org.type]?.[tierForCap] || {};
      const otherCap = capsForType.maxOtherStaff;
      if (otherCap != null) {
        const otherInFlight = await OrgStaffLink.countDocuments({
          org: orgId, role: 'OTHER',
          status: { $in: ['ACTIVE', 'PENDING'] },
        });
        if (otherInFlight >= otherCap) {
          return res.status(403).json({
            error: `Umefikia kikomo cha nafasi za "Nyingine" (${otherCap}).`,
            reason: 'STAFF_OTHER_CAP_HIT',
            cap: otherCap, current: otherInFlight,
          });
        }
      }
    }

    // One-to-one enforcement (application-level for a friendlier error;
    // the DB partial unique index catches races).
    const existingActive = await OrgStaffLink.findOne({ staff: guardianId, status: 'ACTIVE' }).lean();
    if (existingActive) {
      return res.status(409).json({
        error: 'Mfanyakazi tayari yuko kwenye taasisi nyingine.',
        reason: 'STAFF_ALREADY_LINKED',
      });
    }

    // Singleton role enforcement — OWNER / MANAGER / COACH are one-per-org.
    if (SINGLETON_ROLES.includes(role)) {
      const existingRole = await OrgStaffLink.findOne({
        org: orgId, role, status: { $in: ['ACTIVE', 'PENDING'] },
      }).lean();
      if (existingRole) {
        return res.status(409).json({
          error: `Tayari kuna mfanyakazi mmoja katika nafasi ya ${role}. Ondoa au badilisha kabla ya kualika mwingine.`,
          reason: 'STAFF_ROLE_TAKEN',
          role,
        });
      }
    }

    const { customRoleTitle } = req.body;
    const link = await OrgStaffLink.create({
      org: orgId, staff: guardianId, role,
      invitedBy: orgId, status: 'PENDING',
      // Only stored when role === 'OTHER'; ignored otherwise so
      // canonical roles keep their localized display.
      customRoleTitle:
        role === 'OTHER' && customRoleTitle && String(customRoleTitle).trim()
          ? String(customRoleTitle).trim()
          : null,
    });

    // Bell notification to the guardian.
    try {
      const orgName = org.academy_name
        || `${org.firstName || ''} ${org.lastName || ''}`.trim()
        || 'Taasisi';
      await Notification.create({
        userId: guardianId,
        title: 'Ombi la kuwa mfanyakazi',
        body: `${orgName} amekualika ujiunge kama ${role}. Kubali kutoka Uandikishaji wako.`,
        titleKey: 'notif.staff.invite.title',
        bodyKey: 'notif.staff.invite.body',
        params: { org: orgName, role },
        type: 'SYSTEM',
        metadata: { kind: 'STAFF_INVITE', linkId: link._id.toString(), orgId, role },
      });
    } catch (_) { /* best-effort */ }

    return res.status(201).json({ data: link });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'Duplicate invite for this staff+org' });
    }
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/users/:orgId/staff — list ACTIVE + PENDING staff for an org.
router.get(`${BASE}/users/:orgId/staff`, async (req, res) => {
  try {
    const rows = await OrgStaffLink.find({
      org: req.params.orgId,
      status: { $in: ['ACTIVE', 'PENDING'] },
    })
      .populate('staff', 'firstName lastName profileImage accountNumber phone')
      .sort({ createdAt: -1 })
      .lean();
    return res.json({ data: rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/users/:orgId/staff/:linkId/remove — org removes a staff member.
router.post(`${BASE}/users/:orgId/staff/:linkId/remove`, async (req, res) => {
  try {
    const link = await OrgStaffLink.findOneAndUpdate(
      { _id: req.params.linkId, org: req.params.orgId },
      { $set: { status: 'DISABLED', disabledAt: new Date(), disabledReason: 'Removed by org' } },
      { new: true }
    );
    if (!link) return res.status(404).json({ error: 'link not found' });
    try {
      await Notification.create({
        userId: link.staff,
        title: 'Umeondolewa kwenye timu ya wafanyakazi',
        body: 'Taasisi imekuondoa. Wasiliana nao kwa maelezo zaidi.',
        titleKey: 'notif.staff.removed.title',
        bodyKey: 'notif.staff.removed.body',
        params: {},
        type: 'SYSTEM',
        metadata: { linkId: link._id.toString(), orgId: link.org.toString() },
      });
    } catch (_) {}
    return res.json({ data: link });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/users/:guardianId/staff-invitations — list PENDING invites for a guardian.
router.get(`${BASE}/users/:guardianId/staff-invitations`, async (req, res) => {
  try {
    const rows = await OrgStaffLink.find({
      staff: req.params.guardianId, status: 'PENDING',
    })
      .populate('org', 'firstName lastName academy_name type profileImage')
      .sort({ createdAt: -1 })
      .lean();
    return res.json({ data: rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/users/:guardianId/staff-of — the ACTIVE link (if any) for a guardian.
router.get(`${BASE}/users/:guardianId/staff-of`, async (req, res) => {
  try {
    const link = await OrgStaffLink.findOne({
      staff: req.params.guardianId, status: 'ACTIVE',
    })
      .populate('org', 'firstName lastName academy_name type profileImage')
      .lean();
    return res.json({ data: link || null });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/staff-invitations/:linkId/accept
router.post(`${BASE}/staff-invitations/:linkId/accept`, async (req, res) => {
  try {
    const link = await OrgStaffLink.findById(req.params.linkId);
    if (!link) return res.status(404).json({ error: 'invite not found' });
    if (link.status !== 'PENDING') {
      return res.status(400).json({ error: 'invite is not PENDING' });
    }
    // One-to-one: if the guardian is already ACTIVE somewhere else, block.
    const other = await OrgStaffLink.findOne({
      staff: link.staff, status: 'ACTIVE',
    });
    if (other) {
      return res.status(409).json({
        error: 'Tayari uko kama mfanyakazi kwenye taasisi nyingine.',
        reason: 'STAFF_ALREADY_LINKED',
      });
    }
    // Re-check the seat cap in case org downgraded between invite + accept.
    const org = await User.findById(link.org).select('type').lean();
    const cap = await orgStaffCap(link.org, org?.type);
    const activeCount = await OrgStaffLink.countDocuments({
      org: link.org, status: 'ACTIVE',
    });
    if (activeCount >= cap) {
      return res.status(403).json({
        error: `Taasisi hii tayari imefikia kikomo cha wafanyakazi. Wasiliana nao.`,
        reason: 'STAFF_SEATS_FULL', cap, current: activeCount,
      });
    }
    // Re-check singleton role at accept time — another invite for the same
    // role might have been accepted while this one waited.
    if (SINGLETON_ROLES.includes(link.role)) {
      const conflict = await OrgStaffLink.findOne({
        org: link.org, role: link.role, status: 'ACTIVE',
      });
      if (conflict && conflict._id.toString() !== link._id.toString()) {
        return res.status(409).json({
          error: `Tayari kuna mfanyakazi mmoja katika nafasi ya ${link.role}.`,
          reason: 'STAFF_ROLE_TAKEN', role: link.role,
        });
      }
    }
    link.status = 'ACTIVE';
    link.acceptedAt = new Date();
    await link.save();
    return res.json({ data: link });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /v1/staff-invitations/:linkId/decline
router.post(`${BASE}/staff-invitations/:linkId/decline`, async (req, res) => {
  try {
    const link = await OrgStaffLink.findByIdAndUpdate(
      req.params.linkId,
      { $set: { status: 'DECLINED' } },
      { new: true }
    );
    if (!link) return res.status(404).json({ error: 'invite not found' });
    return res.json({ data: link });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
