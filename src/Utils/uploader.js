const multer = require('multer');
const path = require('path');
const lodash = require('lodash');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'public/uploads/');
  },
  key: (req, file, cb) => {
    cb(null, `${Date.now().toString()}-${file.originalname}`);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now().toString()}-${file.originalname}`);
  },
});

const uploadLocal = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200 MB max
});

const uploadFor = () => {
  return (request, response, next) => {
    const upload = uploadLocal.any();

    upload(request, response, (error) => {
      if (error) {
        return next(error);
      }

      if (lodash.isEmpty(request.files)) {
        return next();
      }

      request.body = !lodash.isEmpty(request.body) ? request.body : {};
      lodash.forEach(request.files, ({ fieldname, filename }) => {
        const baseUrl = process.env.BASE_URL || 'https://sokasoko.onrender.com';
        request.body[fieldname] = `${baseUrl}/uploads/${filename}`;
      });

      return next();
    });
  };
};

exports.uploadFor = uploadFor;
