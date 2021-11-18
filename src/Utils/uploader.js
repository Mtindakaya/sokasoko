const multer = require('multer');
const lodash = require('lodash');
const multers3 = require('multer-s3');
const AWS = require('aws-sdk');
const { getString } = require('@lykmapipo/env');

const s3 = new AWS.S3({
  accessKeyId: getString('AWS_ACCESS_KEY_ID'),
  secretAccessKey: getString('AWS_SECRET_ACCESS_KEY'),
});

const uploadS3 = multer({
  storage: multers3({
    s3,
    acl: 'public-read',
    bucket: getString('AWS_STORAGE_BUCKET_NAME'),
    metadata: (req, file, cb) => {
      cb(null, { fieldName: file.fieldname });
    },
    contentType: multers3.AUTO_CONTENT_TYPE,
    key: (req, file, cb) => {
      cb(null, `${Date.now().toString()}-${file.originalname}`);
    },
  }),
});

const uploadFor = () => {
  return (request, response, next) => {
    const upload = uploadS3.any();

    upload(request, response, (error) => {
      if (error) {
        return next(error);
      }

      if (lodash.isEmpty(request.files)) {
        return next();
      }

      request.body = !lodash.isEmpty(request.body) ? request.body : {};
      lodash.forEach(request.files, ({ fieldname, location }) => {
        request.body[fieldname] = location;
      });

      return next();
    });
  };
};

exports.uploadFor = uploadFor;
