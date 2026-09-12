const express = require('express');
const multer = require('multer');
const multerS3 = require('multer-s3');
const AWS = require('aws-sdk');
const crypto = require('crypto');
const { getString } = require('@lykmapipo/env');
const UserFile = require('./user_file.model');
const User = require('../User/user.model');
const { Subscription } = require('../Subscription/subscription.model');

const API_VERSION = getString('API_VERSION', '1.0.0');
const BASE = `/v${API_VERSION.split('.')[0]}`;
const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────
// R2 client — same env config as src/Utils/uploader.js. Duplicated here
// so this feature has its own scoped multer config (per-file 10MB cap,
// PDF/JPG/PNG only, dedicated file-repo/<userId>/<visibility>/ prefix).
// ─────────────────────────────────────────────────────────────────────────
const HAS_S3 =
  !!process.env.AWS_ACCESS_KEY_ID &&
  !!process.env.AWS_SECRET_ACCESS_KEY &&
  !!process.env.S3_BUCKET;
const S3_BUCKET = process.env.S3_BUCKET;
const S3_ENDPOINT = process.env.S3_ENDPOINT || undefined;
const S3_PUBLIC_URL = (process.env.S3_PUBLIC_URL || '').replace(/\/$/, '');

let s3Client = null;
if (HAS_S3) {
  const cfg = {
    region: process.env.S3_REGION || 'auto',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    signatureVersion: 'v4',
  };
  if (S3_ENDPOINT) {
    cfg.endpoint = S3_ENDPOINT;
    cfg.s3ForcePathStyle = true;
  }
  s3Client = new AWS.S3(cfg);
}

const PER_FILE_CAP_BYTES = 10 * 1024 * 1024; // 10MB per file
const SIGNED_URL_TTL_SECONDS = 5 * 60;       // 5-min signed URLs for private

// Per-tier personal-storage quotas (bytes). STANDARD baseline covers
// non-subscription types (SPONSOR, SCHOOL, FA, GUARDIAN, FIELD_OWNER).
const QUOTA_BYTES = {
  STANDARD:   50  * 1024 * 1024,
  GOLD:       500 * 1024 * 1024,
  PLATINUM:   1024 * 1024 * 1024, // 1 GB
  ENTERPRISE: 5 * 1024 * 1024 * 1024, // 5 GB
  PRO:        500 * 1024 * 1024, // SCOUT PRO parity with GOLD
  MINOR:      50  * 1024 * 1024,
  ADULT:      50  * 1024 * 1024,
  FREE:       50  * 1024 * 1024,
};
async function quotaFor(user) {
  if (!user) return QUOTA_BYTES.STANDARD;
  try {
    const tier = await Subscription.getEffectiveTier(user._id, user.type);
    return QUOTA_BYTES[tier] || QUOTA_BYTES.STANDARD;
  } catch (_) {
    return QUOTA_BYTES.STANDARD;
  }
}

function extFromMime(mime) {
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/png') return 'png';
  return 'bin';
}

function generateKey({ userId, visibility, mime }) {
  const uuid = crypto.randomBytes(16).toString('hex');
  return `file-repo/${userId}/${visibility.toLowerCase()}/${uuid}.${extFromMime(mime)}`;
}

// multer instance scoped to this router. fileFilter rejects anything
// outside PDF/JPG/PNG BEFORE the upload starts, so we don't burn
// bandwidth on invalid types.
const upload = HAS_S3
  ? multer({
      storage: multerS3({
        s3: s3Client,
        bucket: S3_BUCKET,
        contentType: multerS3.AUTO_CONTENT_TYPE,
        cacheControl: 'public, max-age=31536000, immutable',
        metadata: (req, file, cb) => cb(null, { fieldname: file.fieldname }),
        key: (req, file, cb) => {
          const userId = req.params.userId || 'unknown';
          const visibility = (req.body?.visibility || 'PRIVATE').toUpperCase();
          cb(null, generateKey({ userId, visibility, mime: file.mimetype }));
        },
      }),
      limits: { fileSize: PER_FILE_CAP_BYTES },
      fileFilter: (req, file, cb) => {
        if (UserFile.MIME_TYPES.includes(file.mimetype)) return cb(null, true);
        return cb(new Error(`Aina ya faili haitumiki: ${file.mimetype}`));
      },
    })
  : null;

// ─────────────────────────────────────────────────────────────────────────
// POST /v1/users/:userId/files  — upload a file to the vault
// multipart: file=<binary>, visibility=PUBLIC|PRIVATE, category=<enum>,
//            displayName=<string>
// ─────────────────────────────────────────────────────────────────────────
router.post(`${BASE}/users/:userId/files`,
  (req, res, next) => {
    if (!upload) {
      return res.status(503).json({
        error: 'File uploads require cloud storage. Contact support.',
      });
    }
    upload.single('file')(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message });
      next();
    });
  },
  async (req, res) => {
    try {
      const { userId } = req.params;
      const file = req.file;
      if (!file) return res.status(400).json({ error: 'file field required' });

      const owner = await User.findById(userId)
        .select('_id type').lean();
      if (!owner) {
        // Owner not found — delete the just-uploaded object and 404.
        await s3Client.deleteObject({ Bucket: S3_BUCKET, Key: file.key })
          .promise().catch(() => {});
        return res.status(404).json({ error: 'User not found' });
      }

      // Quota check AFTER upload completes (unavoidable since we don't
      // know exact size until multer parses). If over-quota, delete
      // the freshly-uploaded object and 402.
      const currentBytes = await UserFile.totalBytesForOwner(userId);
      const quota = await quotaFor(owner);
      if (currentBytes + file.size > quota) {
        await s3Client.deleteObject({ Bucket: S3_BUCKET, Key: file.key })
          .promise().catch(() => {});
        return res.status(402).json({
          error: 'Umefikia kiwango cha uhifadhi. Futa faili au boresha kifurushi.',
          reason: 'STORAGE_QUOTA',
          used: currentBytes,
          quota,
          requested: file.size,
        });
      }

      const visibility = (req.body?.visibility || 'PRIVATE').toUpperCase();
      const category = (req.body?.category || 'OTHER').toUpperCase();
      const displayName = (req.body?.displayName || file.originalname).trim();

      const publicUrl = visibility === 'PUBLIC' && S3_PUBLIC_URL
        ? `${S3_PUBLIC_URL}/${file.key}`
        : '';

      const doc = await UserFile.create({
        owner: userId,
        visibility,
        category: UserFile.CATEGORIES.includes(category) ? category : 'OTHER',
        displayName,
        storageKey: file.key,
        publicUrl,
        mimeType: file.mimetype,
        size: file.size,
      });

      return res.status(201).json({ data: doc });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

// ─────────────────────────────────────────────────────────────────────────
// GET /v1/users/:userId/files  — list files
// ?visibility=PUBLIC|PRIVATE (optional)
// ?category=<enum> (optional)
// ?viewer=<id>  (required to fetch PRIVATE — must equal userId)
// ─────────────────────────────────────────────────────────────────────────
router.get(`${BASE}/users/:userId/files`, async (req, res) => {
  try {
    const { userId } = req.params;
    const { visibility, category, viewer } = req.query;
    const filter = { owner: userId };
    if (visibility) filter.visibility = String(visibility).toUpperCase();
    if (category) filter.category = String(category).toUpperCase();

    // Access gate: PRIVATE files only visible to the owner. If viewer
    // isn't the owner AND visibility isn't explicitly restricted to
    // PUBLIC, silently drop PRIVATE rows from the response.
    const isSelf = viewer && String(viewer) === String(userId);
    if (!isSelf) {
      filter.visibility = 'PUBLIC';
    }

    const rows = await UserFile.find(filter)
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();
    return res.json({ data: rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/users/:userId/files/usage — current bytes used + tier quota
router.get(`${BASE}/users/:userId/files/usage`, async (req, res) => {
  try {
    const owner = await User.findById(req.params.userId)
      .select('_id type').lean();
    if (!owner) return res.status(404).json({ error: 'User not found' });
    const [used, quota] = await Promise.all([
      UserFile.totalBytesForOwner(req.params.userId),
      quotaFor(owner),
    ]);
    return res.json({ data: { usedBytes: used, quotaBytes: quota } });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// PATCH /v1/user-files/:id  — rename, move category, or toggle visibility
// body { actor, displayName?, category?, visibility? }
// ─────────────────────────────────────────────────────────────────────────
router.patch(`${BASE}/user-files/:id`, async (req, res) => {
  try {
    const { actor } = req.body || {};
    const doc = await UserFile.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Not found' });
    if (String(actor) !== String(doc.owner)) {
      return res.status(403).json({ error: 'Only the owner can edit.' });
    }
    const patch = {};
    if (typeof req.body.displayName === 'string') {
      patch.displayName = req.body.displayName.trim();
    }
    if (typeof req.body.category === 'string' &&
        UserFile.CATEGORIES.includes(req.body.category.toUpperCase())) {
      patch.category = req.body.category.toUpperCase();
    }
    if (typeof req.body.visibility === 'string' &&
        UserFile.VISIBILITIES.includes(req.body.visibility.toUpperCase())) {
      patch.visibility = req.body.visibility.toUpperCase();
      // Toggling visibility keeps the same R2 object — we just flip
      // the publicUrl cache so the client can render the direct URL
      // when public, or fall back to signed-URL fetch when private.
      // NOTE: the R2 key path still contains the OLD visibility segment
      // (e.g., /private/xxx.pdf for a doc that's now PUBLIC). Renaming
      // the object in R2 is expensive; the segment is just organisational.
      patch.publicUrl = patch.visibility === 'PUBLIC' && S3_PUBLIC_URL
        ? `${S3_PUBLIC_URL}/${doc.storageKey}`
        : '';
    }
    const updated = await UserFile.findByIdAndUpdate(
      doc._id, { $set: patch }, { new: true },
    ).lean();
    return res.json({ data: updated });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /v1/user-files/:id — hard-delete row + R2 object
router.delete(`${BASE}/user-files/:id`, async (req, res) => {
  try {
    const actor = req.body?.actor || req.query.actor;
    const doc = await UserFile.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Not found' });

    // Owner or admin. Admin gate reused from LiveSession/emancipation
    // patterns — direct isAdmin flag on the actor User.
    if (String(actor) !== String(doc.owner)) {
      const actorUser = await User.findById(actor).select('isAdmin').lean();
      if (!actorUser || !actorUser.isAdmin) {
        return res.status(403).json({ error: 'Only owner or admin.' });
      }
    }

    // Best-effort R2 delete first. If it fails we still remove the DB
    // row — leaving an orphaned R2 object is cheaper than leaving the
    // user with an undeletable file in their UI.
    if (s3Client) {
      await s3Client.deleteObject({ Bucket: S3_BUCKET, Key: doc.storageKey })
        .promise().catch((e) => console.warn('[user-file delete] R2:', e.message));
    }
    await doc.deleteOne();
    return res.json({ data: { _id: doc._id } });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /v1/user-files/:id/signed-url  — short-lived read URL for PRIVATE
// files. Owner only.
router.get(`${BASE}/user-files/:id/signed-url`, async (req, res) => {
  try {
    const actor = req.query.actor;
    const doc = await UserFile.findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ error: 'Not found' });
    if (String(actor) !== String(doc.owner)) {
      return res.status(403).json({ error: 'Only the owner.' });
    }
    if (!s3Client) {
      return res.status(503).json({ error: 'Cloud storage not configured.' });
    }
    // PUBLIC files could serve the direct URL, but we still generate
    // signed for consistency — client should call this same endpoint
    // regardless of visibility. Cheap.
    const url = s3Client.getSignedUrl('getObject', {
      Bucket: S3_BUCKET,
      Key: doc.storageKey,
      Expires: SIGNED_URL_TTL_SECONDS,
    });
    return res.json({
      data: { url, expiresInSeconds: SIGNED_URL_TTL_SECONDS },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
