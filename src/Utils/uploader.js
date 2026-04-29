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
        request.body[fieldname] = `http://192.168.1.134:5001/uploads/${filename}`;
      });

      return next();
    });
  };
};

exports.uploadFor = uploadFor;
