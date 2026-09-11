const multer = require('multer');
const multerS3 = require('multer-s3');
const AWS = require('aws-sdk');
const lodash = require('lodash');

// Upload strategy:
//   - S3-compatible object storage when creds + bucket env vars are set.
//     Works with AWS S3 (leave S3_ENDPOINT unset) OR Cloudflare R2 (set
//     S3_ENDPOINT to the R2 API URL). R2 is preferred — zero egress
//     fees, edge network included.
//   - Local disk fallback otherwise (dev machines without cloud config).
//
// Required env vars (Render / production):
//   AWS_ACCESS_KEY_ID       — R2 API token access key, or S3 access key
//   AWS_SECRET_ACCESS_KEY   — R2 API token secret, or S3 secret key
//   S3_BUCKET               — bucket name (e.g. "sokasoko-media")
//   S3_REGION               — "auto" for R2; a region name for S3
//   S3_ENDPOINT             — R2: https://<account_id>.r2.cloudflarestorage.com
//                             S3: leave unset (SDK picks the default)
//   S3_PUBLIC_URL           — R2: https://pub-<hash>.r2.dev  (or a custom domain)
//                             S3: leave unset (uses file.location, which is
//                             the S3 URL directly if the bucket policy
//                             allows public reads)
//
// Old local-disk URLs in the DB will now 404 because the /uploads static
// route was removed in 2026-09-11. Run scripts/nullify-stale-profile-
// images.js to null the dead references so clients render the default
// avatar cleanly instead of a broken image icon.

const HAS_S3 =
  !!process.env.AWS_ACCESS_KEY_ID &&
  !!process.env.AWS_SECRET_ACCESS_KEY &&
  !!process.env.S3_BUCKET;

const S3_REGION = process.env.S3_REGION || 'auto';
const S3_BUCKET = process.env.S3_BUCKET;
const S3_ENDPOINT = process.env.S3_ENDPOINT || undefined; // R2 endpoint
const S3_PUBLIC_URL = (process.env.S3_PUBLIC_URL || '').replace(/\/$/, '');

let uploadCore;
if (HAS_S3) {
  const s3Config = {
    region: S3_REGION,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    signatureVersion: 'v4',
  };
  if (S3_ENDPOINT) {
    // R2 (or any S3-compatible provider) requires an explicit endpoint
    // and path-style URLs. AWS S3 leaves this unset and uses the default.
    s3Config.endpoint = S3_ENDPOINT;
    s3Config.s3ForcePathStyle = true;
  }
  const s3 = new AWS.S3(s3Config);

  uploadCore = multer({
    storage: multerS3({
      s3,
      bucket: S3_BUCKET,
      contentType: multerS3.AUTO_CONTENT_TYPE,
      cacheControl: 'public, max-age=31536000, immutable',
      metadata: (req, file, cb) => cb(null, { fieldname: file.fieldname }),
      key: (req, file, cb) => {
        // Path prefix keeps the bucket organised. Feature-based prefixes
        // (profile/, media/, advert/, etc.) will land in Phase 2 when
        // per-user storage quotas need per-feature accounting.
        cb(null, `uploads/${Date.now()}-${file.originalname}`);
      },
    }),
    limits: { fileSize: 200 * 1024 * 1024 },
  });
  console.log(
    `[uploader] Object-storage mode → bucket=${S3_BUCKET} region=${S3_REGION}` +
      (S3_ENDPOINT ? ` endpoint=${S3_ENDPOINT}` : '') +
      (S3_PUBLIC_URL ? ` public=${S3_PUBLIC_URL}` : '')
  );
} else {
  uploadCore = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => cb(null, 'public/uploads/'),
      filename: (req, file, cb) =>
        cb(null, `${Date.now().toString()}-${file.originalname}`),
    }),
    limits: { fileSize: 200 * 1024 * 1024 },
  });
  console.log('[uploader] Local disk mode (no cloud storage env vars)');
}

// Compose the public URL for an uploaded object. R2's file.location
// points at the private API endpoint (not browser-accessible); we
// rewrite to the S3_PUBLIC_URL + key form so the URL we hand back to
// the client is what the client can actually GET. AWS S3 mode leaves
// file.location as-is (already a public URL if the bucket policy
// allows public reads).
function publicUrlFor(file) {
  if (S3_PUBLIC_URL && file.key) return `${S3_PUBLIC_URL}/${file.key}`;
  if (file.location) return file.location;
  return `${process.env.BASE_URL || 'https://sokasoko.onrender.com'}/uploads/${file.filename}`;
}

const uploadFor = () => {
  return (request, response, next) => {
    const upload = uploadCore.any();

    upload(request, response, (error) => {
      if (error) return next(error);
      if (lodash.isEmpty(request.files)) return next();

      request.body = !lodash.isEmpty(request.body) ? request.body : {};
      lodash.forEach(request.files, (file) => {
        request.body[file.fieldname] = publicUrlFor(file);
      });

      return next();
    });
  };
};

exports.uploadFor = uploadFor;
