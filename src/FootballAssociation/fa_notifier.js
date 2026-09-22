// Fires FA-directed notifications when a new entity registers in
// their district, or when the entity's leadership changes. Fully
// idempotent — safe to call multiple times per event; dedupe via
// notification metadata + entity flags.

const mongoose = require('mongoose');
const { entityLabel } = require('../Utils/utils');

const ENTITY_TYPES = ['ACADEMY', 'CLUB', 'SCHOOL'];

// Normalise region names so "Arusha" matches "Arusha Region".
function normaliseRegion(s) {
  if (typeof s !== 'string') return '';
  let v = s.trim();
  if (v.toLowerCase().endsWith(' region')) {
    v = v.substring(0, v.length - ' region'.length);
  }
  return v.trim().toLowerCase();
}

// Find all FA accounts whose region + (optional) district match the
// entity's location. Case-insensitive; district match only when the
// FA has a district set (so a national/regional FA account with only
// region covers every district in that region).
async function findFasFor(entity) {
  if (!entity || !entity.region) return [];
  const User = mongoose.model('User');
  const targetRegion = normaliseRegion(entity.region);
  const fas = await User.find({ type: 'FOOTBALL_ASSOCIATION' })
    .select('_id region district')
    .lean();
  return fas.filter((fa) => {
    if (normaliseRegion(fa.region) !== targetRegion) return false;
    const faDistrict = (fa.district || '').trim().toLowerCase();
    const entityDistrict = (entity.district || '').trim().toLowerCase();
    if (!faDistrict) return true;
    return faDistrict === entityDistrict;
  });
}

async function notifyFaOfNewEntity(entity) {
  try {
    if (!entity || !ENTITY_TYPES.includes(entity.type)) return;
    if (!entity.region) return;
    const fas = await findFasFor(entity);
    if (!fas.length) return;
    const Notification = mongoose.model('Notification');
    const entityName = entityLabel(entity) || 'taasisi';
    await Promise.all(fas.map((fa) => Notification.create({
      userId: fa._id,
      type: 'SYSTEM',
      title: 'Taasisi mpya wilayani',
      body: `${entityName} amejisajili katika wilaya yako.`,
      titleKey: 'notif.fa.entity_registered.title',
      bodyKey: 'notif.fa.entity_registered.body',
      params: {
        entity: entityName,
        entityType: entity.type,
      },
      metadata: {
        kind: 'FA_ENTITY_REGISTERED',
        entityId: entity._id,
        entityType: entity.type,
      },
    })));
  } catch (err) {
    console.log('[fa_notifier] entity notify failed:', err.message);
  }
}

async function notifyFaOfStaffChange(link) {
  try {
    if (!link || !link.org) return;
    const User = mongoose.model('User');
    const org = await User.findById(link.org)
      .select('type region district firstName lastName academy_name entity_name company_name football_field_name')
      .lean();
    if (!org || !ENTITY_TYPES.includes(org.type)) return;
    const staff = await User.findById(link.staff)
      .select('firstName lastName')
      .lean();
    const fas = await findFasFor(org);
    if (!fas.length) return;
    const Notification = mongoose.model('Notification');
    const orgName = entityLabel(org) || 'taasisi';
    const staffName = staff
      ? `${staff.firstName || ''} ${staff.lastName || ''}`.trim()
      : 'mfanyakazi';
    await Promise.all(fas.map((fa) => Notification.create({
      userId: fa._id,
      type: 'SYSTEM',
      title: 'Mabadiliko ya wafanyakazi',
      body: `${orgName} wamemwongeza ${staffName} kama ${link.role}.`,
      titleKey: 'notif.fa.entity_staff_changed.title',
      bodyKey: 'notif.fa.entity_staff_changed.body',
      params: {
        entity: orgName,
        staff: staffName,
        role: link.role,
      },
      metadata: {
        kind: 'FA_ENTITY_STAFF_CHANGED',
        entityId: org._id,
        staffId: link.staff,
        role: link.role,
        linkId: link._id,
      },
    })));
  } catch (err) {
    console.log('[fa_notifier] staff notify failed:', err.message);
  }
}

module.exports = {
  notifyFaOfNewEntity,
  notifyFaOfStaffChange,
  ENTITY_TYPES,
};
