"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadBroadcastPhoto = exports.uploadDriverPhoto = exports.uploadsDir = void 0;
exports.isValidImageFile = isValidImageFile;
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
/**
 * `fileFilter` в multer видит только заголовок Content-Type, который
 * присылает клиент — его легко подделать (например, назвать .php файл
 * image/jpeg). Здесь уже после записи на диск проверяем настоящую сигнатуру
 * (magic bytes) файла — это и есть реальная защита от загрузки не-картинки
 * под видом картинки. Вызывать после multer, до того как файл где-либо
 * используется (например, отправляется в Telegram/MAX).
 */
function isValidImageFile(filePath) {
    let fd;
    try {
        fd = fs_1.default.openSync(filePath, 'r');
    }
    catch {
        return false;
    }
    try {
        const buf = Buffer.alloc(12);
        const bytesRead = fs_1.default.readSync(fd, buf, 0, 12, 0);
        if (bytesRead < 4)
            return false;
        if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
            return true; // JPEG
        if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
            buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a)
            return true; // PNG
        if (bytesRead === 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP')
            return true; // WebP
        return false;
    }
    finally {
        fs_1.default.closeSync(fd);
    }
}
