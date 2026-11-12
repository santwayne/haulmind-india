import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

// Local disk storage. Logistiq's S3 upload (middleware/upload.js there) can be dropped in
// later by swapping this storage for multer-s3 — controllers only read req.file.
const dir = path.resolve('uploads/pod');
fs.mkdirSync(dir, { recursive: true });

const allowed = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp', 'application/pdf'];

export const podUpload = multer({
  storage: multer.diskStorage({
    destination: dir,
    filename: (req, file, cb) =>
      cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error('Only JPG, PNG, WEBP or PDF allowed')),
});
