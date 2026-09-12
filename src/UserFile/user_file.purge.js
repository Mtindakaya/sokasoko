// Purge a user's file vault — used from the account-deletion path.
// GDPR / data-minimisation posture: when the user is gone, so are
// their files. Best-effort R2 delete + hard row delete.

const AWS = require('aws-sdk');
const UserFile = require('./user_file.model');

const HAS_S3 =
  !!process.env.AWS_ACCESS_KEY_ID &&
  !!process.env.AWS_SECRET_ACCESS_KEY &&
  !!process.env.S3_BUCKET;
const S3_BUCKET = process.env.S3_BUCKET;

let s3Client = null;
if (HAS_S3) {
  const cfg = {
    region: process.env.S3_REGION || 'auto',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    signatureVersion: 'v4',
  };
  if (process.env.S3_ENDPOINT) {
    cfg.endpoint = process.env.S3_ENDPOINT;
    cfg.s3ForcePathStyle = true;
  }
  s3Client = new AWS.S3(cfg);
}

async function purgeUserFilesForOwner(ownerId) {
  const rows = await UserFile.find({ owner: ownerId })
    .select('_id storageKey').lean();
  if (rows.length === 0) return { deleted: 0 };

  // R2 delete-many via batch DeleteObjects (up to 1000 per call).
  if (s3Client && rows.length > 0) {
    const objects = rows.map((r) => ({ Key: r.storageKey }));
    // Chunk into groups of 1000 in case a user has more (they can't
    // today given the 10MB per-file + 1GB max cap = ~100 files, but
    // defensive coding is cheap).
    for (let i = 0; i < objects.length; i += 1000) {
      const slice = objects.slice(i, i + 1000);
      try {
        await s3Client.deleteObjects({
          Bucket: S3_BUCKET,
          Delete: { Objects: slice, Quiet: true },
        }).promise();
      } catch (e) {
        console.warn(`[user-file purge] R2 batch delete failed (${i}):`, e.message);
      }
    }
  }

  const result = await UserFile.deleteMany({ owner: ownerId });
  return { deleted: result.deletedCount || rows.length };
}

module.exports = { purgeUserFilesForOwner };
