/**
 * One-off backfill: seed CareerEvent rows from the current live
 * state so the CV screen has something to render on the day the
 * feature ships.
 *
 *   - For every User with `academy` set → walk the VERIFIED Academy
 *     row and create one open CareerEvent (role: PLAYER). joinedAt
 *     comes from Academy.verifiedAt (or createdAt as fallback).
 *   - For every User with `school` set → create one open
 *     CareerEvent (role: STUDENT). joinedAt is best-guess from
 *     User.updatedAt and is flagged with joinedAtEstimated: true so
 *     the client can badge it accordingly.
 *   - For every COACH with `linkedAcademy` set → create one open
 *     CareerEvent (role: COACH). joinedAt best-guess from
 *     User.updatedAt, joinedAtEstimated: true.
 *
 * Idempotent: only creates a row if no open CareerEvent already
 * exists for that (player, entity) pair.
 *
 * Run:  MONGODB_URI="mongodb+srv://..." node scripts/backfill-career-events.js
 */
const mongoose = require('mongoose');

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set');
    process.exit(1);
  }
  await mongoose.connect(uri);

  // Load models after connect so their schemas are registered.
  const User = require('../src/User/user.model');
  const Academy = require('../src/Academy/academy.model');
  const CareerEvent = require('../src/CareerEvent/career_event.model');

  const label = (u) =>
    (u.academy_name && u.academy_name.trim())
    || (u.company_name && u.company_name.trim())
    || (u.entity_name && u.entity_name.trim())
    || `${u.firstName || ''} ${u.lastName || ''}`.trim()
    || 'Unknown';

  let seededAcademy = 0, seededSchool = 0, seededCoach = 0, skipped = 0;

  // 1. Academies (players)
  const enrolledPlayers = await User.find({ academy: { $ne: null } })
    .select('_id academy').lean();
  for (const p of enrolledPlayers) {
    const row = await Academy.findById(p.academy).lean();
    if (!row || row.verificationStatus !== 'VERIFIED') continue;
    const org = await User.findById(row.addedBy)
      .select('type academy_name company_name entity_name firstName lastName').lean();
    if (!org) continue;
    const dupe = await CareerEvent.findOne({
      player: p._id, entity: row.addedBy, leftAt: null,
    }).select('_id').lean();
    if (dupe) { skipped++; continue; }
    await CareerEvent.create({
      player: p._id,
      entity: row.addedBy,
      entityType: org.type === 'CLUB' ? 'CLUB' : 'ACADEMY',
      entityNameSnapshot: label(org),
      level: row.level || '',
      role: 'PLAYER',
      joinedAt: row.verifiedAt || row.createdAt || new Date(),
      source: 'ACADEMY_ENROLLMENT',
      sourceRef: row._id,
      joinedAtEstimated: !row.verifiedAt,
    });
    seededAcademy++;
  }

  // 2. Schools (students)
  const enrolledStudents = await User.find({ school: { $ne: null } })
    .select('_id school school_class updatedAt').lean();
  for (const s of enrolledStudents) {
    const org = await User.findById(s.school)
      .select('type academy_name company_name entity_name firstName lastName').lean();
    if (!org) continue;
    const dupe = await CareerEvent.findOne({
      player: s._id, entity: s.school, leftAt: null,
    }).select('_id').lean();
    if (dupe) { skipped++; continue; }
    await CareerEvent.create({
      player: s._id,
      entity: s.school,
      entityType: 'SCHOOL',
      entityNameSnapshot: label(org),
      level: s.school_class || '',
      role: 'STUDENT',
      joinedAt: s.updatedAt || new Date(),
      source: 'SCHOOL_LINK',
      sourceRef: s.school,
      joinedAtEstimated: true,
    });
    seededSchool++;
  }

  // 3. Coaches
  const linkedCoaches = await User.find({
    type: 'COACH', linkedAcademy: { $ne: null },
  }).select('_id linkedAcademy updatedAt').lean();
  for (const c of linkedCoaches) {
    const org = await User.findById(c.linkedAcademy)
      .select('type academy_name company_name entity_name firstName lastName').lean();
    if (!org) continue;
    const dupe = await CareerEvent.findOne({
      player: c._id, entity: c.linkedAcademy, leftAt: null,
    }).select('_id').lean();
    if (dupe) { skipped++; continue; }
    await CareerEvent.create({
      player: c._id,
      entity: c.linkedAcademy,
      entityType: org.type === 'CLUB' ? 'CLUB' : 'ACADEMY',
      entityNameSnapshot: label(org),
      role: 'COACH',
      joinedAt: c.updatedAt || new Date(),
      source: 'COACH_LINK',
      sourceRef: c.linkedAcademy,
      joinedAtEstimated: true,
    });
    seededCoach++;
  }

  console.log(`Seeded: ${seededAcademy} academy · ${seededSchool} school · ${seededCoach} coach`);
  console.log(`Skipped (already had an open row): ${skipped}`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error('backfill failed:', e.message);
  process.exit(1);
});
