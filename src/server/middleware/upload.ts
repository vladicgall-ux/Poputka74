import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { config } from '../../config';
import type { AuthedRequest } from './auth';

export const uploadsDir = path.join(path.dirname(config.dbPath), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    // Middleware order guarantees requireTelegramAuth ran first, so req.user is set.
    const telegramId = (req as unknown as AuthedRequest).user.telegram_id;
    const ext = ALLOWED_TYPES[file.mimetype] ?? '.jpg';
    cb(null, `driver-${telegramId}-${Date.now()}${ext}`);
  },
});

export const uploadDriverPhoto = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_TYPES[file.mimetype]) {
      cb(new Error('Разрешены только изображения JPEG, PNG или WebP'));
      return;
    }
    cb(null, true);
  },
});
