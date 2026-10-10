const express = require('express');
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const User = require('../User/user.model');

const router = express.Router();

const NECTA_PATH = path.join(__dirname, 'data', 'TZ_Schools_NECTA_2025.csv');
const TCU_PATH = path.join(__dirname, 'data', 'TZ_Universities_TCU_2026.csv');

// In-memory registry. Loaded lazily on first access, kept for the
// process lifetime. 25k Primary/Secondary rows + ~60 universities fits
// comfortably in RAM; refreshing requires a restart, which is fine for
// annually-updated government lists.
let _cache = null;

function _normalize(s) {
  return (s || '').toString().trim();
}

function _loadNecta() {
  const raw = fs.readFileSync(NECTA_PATH, 'utf8');
  const rows = parse(raw, {
    columns: true, skip_empty_lines: true, trim: true, bom: true,
  });
  return rows.map((r) => ({
    registrationNumber: _normalize(r.reg_no),
    name: _normalize(r.name_display) || _normalize(r.name),
    stage: (_normalize(r.school_type).toUpperCase() === 'SECONDARY')
      ? 'SECONDARY' : 'PRIMARY',
    region: _normalize(r.region),
    source: 'NECTA',
  })).filter((r) => r.registrationNumber && r.name);
}

function _loadTcu() {
  const raw = fs.readFileSync(TCU_PATH, 'utf8');
  const rows = parse(raw, {
    columns: true, skip_empty_lines: true, trim: true, bom: true,
  });
  return rows.map((r) => ({
    registrationNumber: _normalize(r.acronym) || _normalize(r.id),
    name: _normalize(r.display) || _normalize(r.name),
    stage: 'CHUO',
    region: _normalize(r.region),
    source: 'TCU',
  })).filter((r) => r.registrationNumber && r.name);
}

function _ensureCache() {
  if (_cache) return _cache;
  const nerca = _loadNecta();
  const tcu = _loadTcu();
  _cache = { all: [...nerca, ...tcu] };
  console.log(`[SCHOOLS-REGISTRY] loaded ${nerca.length} NECTA + ${tcu.length} TCU`);
  return _cache;
}

// GET /v1/schools-registry?stage=PRIMARY|SECONDARY|CHUO&query=<text>&limit=50
// Returns a union of SokaSoko School accounts (flagged isSokaSokoActive:true)
// and the registry rows for the requested stage, ordered: active-first
// then alphabetical. query substring-matches on name OR registrationNumber.
router.get('/v1/schools-registry', async (req, res) => {
  try {
    const stage = (_normalize(req.query.stage) || '').toUpperCase();
    const query = _normalize(req.query.query).toLowerCase();
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    if (!['PRIMARY', 'SECONDARY', 'CHUO'].includes(stage)) {
      return res.status(400).json({
        error: 'stage must be one of PRIMARY, SECONDARY, CHUO',
      });
    }

    // SokaSoko School accounts first.
    const sokaRows = await User.find({ type: 'SCHOOL', school_type: stage })
      .select('_id academy_name school_id region').lean();
    const sokaKeys = new Set(
      sokaRows.map((r) => (r.school_id || '').trim().toUpperCase())
        .filter((k) => !!k),
    );
    const active = sokaRows.map((r) => ({
      sokaId: String(r._id),
      registrationNumber: (r.school_id || '').trim(),
      name: (r.academy_name || '').trim(),
      stage,
      region: (r.region || '').trim(),
      source: 'SOKASOKO',
      isSokaSokoActive: true,
    }));

    // Registry entries that aren't duplicated by an active SokaSoko account.
    _ensureCache();
    const registry = _cache.all
      .filter((r) => r.stage === stage)
      .filter((r) => !sokaKeys.has(r.registrationNumber.toUpperCase()))
      .map((r) => ({
        sokaId: null,
        registrationNumber: r.registrationNumber,
        name: r.name,
        stage,
        region: r.region,
        source: r.source,
        isSokaSokoActive: false,
      }));

    let combined = [...active, ...registry];
    if (query) {
      combined = combined.filter((r) => (
        r.name.toLowerCase().includes(query)
        || r.registrationNumber.toLowerCase().includes(query)
      ));
    }
    // Active-first, then alphabetical. Keeps SokaSoko schools pinned at
    // the top of a scroll while still allowing search to narrow.
    combined.sort((a, b) => {
      if (a.isSokaSokoActive !== b.isSokaSokoActive) {
        return a.isSokaSokoActive ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    return res.status(200).json({
      data: combined.slice(0, limit),
      total: combined.length,
    });
  } catch (err) {
    console.log('[SCHOOLS-REGISTRY] error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
