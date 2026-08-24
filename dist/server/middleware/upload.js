"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadBroadcastPhoto = exports.uploadDriverPhoto = exports.uploadsDir = void 0;
const multer_1 = __importDefault(require("multer"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const config_1 = require("../../config");
exports.uploadsDir = path_1.default.join(path_1.default.dirname(config_1.config.dbPath), 'uploads');
if (!fs_1.default.existsSync(exports.uploadsDir)) {
    fs_1.default.mkdirSync(exports.uploadsDir, { recursive: true });
}
const ALLOWED_TYPES = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
};
const storage = multer_1.default.diskStorage({
    destination: (_req, _file, cb) => cb(null, exports.uploadsDir),
    filename: (req, file, cb) => {
        // Middleware order guarantees requireTelegramAuth ran first, so req.user is set.
        const telegramId = req.user.telegram_id;
        const ext = ALLOWED_TYPES[file.mimetype] ?? '.jpg';
        cb(null, `driver-${telegramId}-${Date.now()}${ext}`);
    },
});
exports.uploadDriverPhoto = (0, multer_1.default)({
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
const broadcastStorage = multer_1.default.diskStorage({
    destination: (_req, _file, cb) => cb(null, exports.uploadsDir),
    filename: (_req, file, cb) => {
        const ext = ALLOWED_TYPES[file.mimetype] ?? '.jpg';
        cb(null, `broadcast-${Date.now()}${ext}`);
    },
});
/** Фото для массовой рассылки из админки — не привязано к конкретному водителю,
 *  удаляется сразу после отправки (не должно оставаться в /uploads навсегда). */
exports.uploadBroadcastPhoto = (0, multer_1.default)({
    storage: broadcastStorage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        if (!ALLOWED_TYPES[file.mimetype]) {
            cb(new Error('Разрешены только изображения JPEG, PNG или WebP'));
            return;
        }
        cb(null, true);
    },
});
