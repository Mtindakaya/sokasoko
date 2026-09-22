const express = require('express');
const { getString } = require('@lykmapipo/env');
const User = require('../User/user.model');
const OrgStaffLink = require('../OrgStaff/org_staff.model');
const { entityLabel } = require('../Utils/utils');

const API_VERSION = getString('API_VERSION', '1.0.0');
const router = express.Router();
const BASE = `/v${API_VERSION.split('.')[0]}/fa`;

// Roles that count as "leadership" — surfaced on the district directory
// as the entity's contact-of-record. Custom roles (OTHER) intentionally
// excluded to keep the panel focused.
const LEADERSHIP_ROLES = ['OWNER', 'MANAGER', 'SECRETARY', 'COACH'];

// Default entity types when caller doesn't pass ?types=. Excludes VENDOR
// and FIELD_OWNER — those are trading accounts, not football entities.
const DEFAULT_TYPES = ['ACADEMY', 'CLUB', 'SCHOOL'];

// GET /v1/fa/district-directory?region=X&district=Y&types=ACADEMY,CLUB
// Returns entities in the FA's registered district plus their
// leadership names. Only names + roles are exposed — this is a
// directory of public-facing info, not private contact data.
router.get(`${BASE}/district-directory`, async (req, res) => {
  try {
    const { region, district, types, page = 1, limit = 100 } = req.query || {};
    if (!region) {
      return res.status(400).json({
        error: 'region query param is required',
        errorKey: 'fa.directory.err.no_region',
      });
    }
    const typeList = (typeof types === 'string' && types.trim())
      ? types.split(',').map((s) => s.trim()).filter(Boolean)
      : DEFAULT_TYPES;

    const filter = {
      type: { $in: typeList },
      region: new RegExp(`^${escapeRegex(region.trim())}$`, 'i'),
    };
    if (district) {
      filter.district = new RegExp(`^${escapeRegex(district.trim())}$`, 'i');
    }

    const entities = await User.find(filter)
      .select('firstName lastName type academy_name entity_name company_name football_field_name accountNumber profileImage region district createdAt supportedAgeLevels supportedGenders')
      .sort({ createdAt: -1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit))
      .lean();

    // District-wide counts (independent of the current type filter so
    // the header shows the full picture even when the user is looking
    // at, say, just Academies).
    const statsFilter = { region: filter.region };
    if (filter.district) statsFilter.district = filter.district;
    const countsAgg = await User.aggregate([
      {
        $match: {
          ...statsFilter,
          type: { $in: ['ACADEMY', 'CLUB', 'SCHOOL'] },
        },
      },
      { $group: { _id: '$type', n: { $sum: 1 } } },
    ]);
    const stats = { ACADEMY: 0, CLUB: 0, SCHOOL: 0 };
    for (const row of countsAgg) {
      stats[row._id] = row.n;
    }

    if (!entities.length) {
      return res.status(200).json({ data: [], stats });
    }

    const ids = entities.map((e) => e._id);
    const links = await OrgStaffLink.find({
      org: { $in: ids },
      status: 'ACTIVE',
      role: { $in: LEADERSHIP_ROLES },
    })
      .populate('staff', 'firstName lastName type accountNumber')
      .lean();

    // Group leadership by org for O(1) lookup during map below.
    const leadershipByOrg = new Map();
    for (const l of links) {
      if (!l.staff) continue;
      const key = String(l.org);
      if (!leadershipByOrg.has(key)) leadershipByOrg.set(key, []);
      leadershipByOrg.get(key).push({
        staffId: l.staff._id,
        name: `${l.staff.firstName || ''} ${l.staff.lastName || ''}`.trim(),
        accountNumber: l.staff.accountNumber || '',
        role: l.role,
      });
    }

    const rows = entities.map((e) => ({
      _id: e._id,
      name: entityLabel(e) || `${e.firstName || ''} ${e.lastName || ''}`.trim(),
      type: e.type,
      accountNumber: e.accountNumber,
      profileImage: e.profileImage,
      region: e.region,
      district: e.district,
      registeredAt: e.createdAt,
      supportedAgeLevels: e.supportedAgeLevels || [],
      supportedGenders: e.supportedGenders || [],
      leadership: leadershipByOrg.get(String(e._id)) || [],
    }));

    return res.status(200).json({ data: rows, stats });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = router;
