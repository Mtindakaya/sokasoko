const express = require('express');
const { getString } = require('@lykmapipo/env');
const multer = require('multer');
const csv = require('csv-parse/sync');
const fs = require('fs');
const Venue = require('./venue.model');

const API_VERSION = getString('API_VERSION', '1.0.0');
const router = express.Router();
const BASE = `/v${API_VERSION.split('.')[0]}/venues`;

const upload = multer({ dest: 'public/uploads/tmp/' });

// POST /v1/venues/import — bulk import venues from CSV
router.post(`${BASE}/import`, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const fileContent = fs.readFileSync(req.file.path, 'utf8');
    const records = csv.parse(fileContent, { columns: true, skip_empty_lines: true, trim: true });

    const results = { created: 0, failed: 0, errors: [] };

    for (const record of records) {
      try {
        await Venue.create({
          name: record.name,
          region: record.region,
          district: record.district,
          ward: record.ward || undefined,
          serikaliYaMtaa: record.serikaliYaMtaa || undefined,
          street: record.street || undefined,
          capacity: record.capacity ? parseInt(record.capacity) : 0,
          surfaceType: record.surfaceType || 'NATURAL_GRASS',
          description: record.description || undefined,
        });
        results.created++;
      } catch (err) {
        results.failed++;
        results.errors.push({ row: record.name, error: err.message });
      }
    }

    // Clean up temp file
    fs.unlinkSync(req.file.path);

    return res.status(200).json({ message: `Import complete`, ...results });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
