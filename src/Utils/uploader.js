const multer = require('multer');
const multerS3 = require('multer-s3');
const AWS = require('aws-sdk');
const lodash = require('lodash');

// Upload strategy:
//   - S3 when AWS creds + S3_BUCKET env vars are set (production / Render).
//   - Local disk fallback otherwise (dev machines without S3 config).
// Old local URLs surviving in the DB stay valid because Render still
// serves them via app.use('/uploads', express.static('public/uploads'))
// — they just won't survive the next redeploy. New uploads go to S3
// and live forever.

const HAS_S3 =
  !!process.env.AWS_ACCESS_KEY_ID &&
  !!process.env.AWS_SECRET_ACCESS_KEY &&
  !!process.env.S3_BUCKET;

const S3_REGION = process.env.AWS_REGION || 'us-west-2';
const S3_BUCKET = process.env.S3_BUCKET;

let uploadCore;
if (HAS_S3) {
  const s3 = new AWS.S3({
    region: S3_REGION,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    signatureVersion: 'v4',
  });
  uploadCore = multer({
    storage: multerS3({
      s3,
      bucket: S3_BUCKET,
      acl: 'public-read',
      contentType: multerS3.AUTO_CONTENT_TYPE,
      cacheControl: 'public, max-age=31536000, immutable',
      metadata: (req, file, cb) => cb(null, { fieldname: file.fieldname }),
      key: (req, file, cb) => {
        // Path prefix keeps the bucket organised without needing folders
        // per feature: uploads/1725456789-image_picker....jpg
        cb(null, `uploads/${Date.now()}-${file.originalname}`);
      },
    }),
    limits: { fileSize: 200 * 1024 * 1024 },
  });
  console.log(`[uploader] S3 mode → bucket=${S3_BUCKET} region=${S3_REGION}`);
} else {
  uploadCore = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => cb(null, 'public/uploads/'),
      filename: (req, file, cb) =>
        cb(null, `${Date.now().toString()}-${file.originalname}`),
    }),
    limits: { fileSize: 200 * 1024 * 1024 },
  });
  console.log('[uploader] Local disk mode (no S3 env vars)');
}

const uploadFor = () => {
  return (request, response, next) => {
    const upload = uploadCore.any();

    upload(request, response, (error) => {
      if (error) return next(error);
      if (lodash.isEmpty(request.files)) return next();

      request.body = !lodash.isEmpty(request.body) ? request.body : {};
      lodash.forEach(request.files, (file) => {
        // multer-s3 puts the full public URL on file.location; local
        // disk driver puts filename on file.filename and we build the
        // Render URL ourselves.
        const url = file.location
          ? file.location
          : `${process.env.BASE_URL || 'https://sokasoko.onrender.com'}/uploads/${file.filename}`;
        request.body[file.fieldname] = url;
      });

      return next();
    });
  };
};

exports.uploadFor = uploadFor;
