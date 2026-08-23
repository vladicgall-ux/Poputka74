"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.usersRouter = void 0;
const express_1 = require("express");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const auth_1 = require("../middleware/auth");
const rateLimit_1 = require("../middleware/rateLimit");
const userService_1 = require("../../services/userService");
const ratingService_1 = require("../../services/ratingService");
const config_1 = require("../../config");
const upload_1 = require("../middleware/upload");
exports.usersRouter = (0, express_1.Router)();
exports.usersRouter.use(auth_1.requireTelegramAuth);
/** Профиль текущего пользователя: данные аккаунта + анкета водителя (если есть). */
exports.usersRouter.get('/me', (req, res) => {
    const { user } = req;
    const driverProfile = (0, userService_1.getDriverProfile)(user.telegram_id) ?? null;
    const isAdmin = config_1.config.adminIds.includes(user.telegram_id);
    const rating = driverProfile ? (0, ratingService_1.getDriverRatingSummary)(user.telegram_id) : null;
    res.json({ user, driverProfile, isAdmin, rating });
});
/** Регистрация/обновление анкеты водителя. Требует подтверждённый телефон — защита от фейков. */
exports.usersRouter.post('/me/driver-profile', auth_1.requireActiveUser, (0, rateLimit_1.writeLimiter)(20, 10 * 60000), (req, res) => {
    const { user } = req;
    const { car_model, car_color, car_plate, experience } = req.body ?? {};
    if (!car_model || typeof car_model !== 'string' || !car_plate || typeof car_plate !== 'string') {
        res.status(400).json({ error: 'Укажите модель и госномер автомобиля' });
        return;
    }
    const profile = (0, userService_1.upsertDriverProfile)(user.telegram_id, {
        car_model: car_model.trim().slice(0, 100),
        car_color: typeof car_color === 'string' ? car_color.trim().slice(0, 40) : undefined,
        car_plate: car_plate.trim().slice(0, 20),
        experience: typeof experience === 'string' ? experience.trim().slice(0, 300) : undefined,
    });
    res.json({ driverProfile: profile });
});
/** Загрузка фото водителя или машины — отдельно от JSON-анкеты, т.к. это multipart-запрос. */
exports.usersRouter.post('/me/photo', auth_1.requireActiveUser, (0, rateLimit_1.writeLimiter)(10, 10 * 60000), (req, res, next) => {
    upload_1.uploadDriverPhoto.single('photo')(req, res, (err) => {
        if (err) {
            res.status(400).json({ error: err instanceof Error ? err.message : 'Не удалось загрузить фото' });
            return;
        }
        next();
    });
}, (req, res) => {
    const { user } = req;
    const file = req.file;
    if (!file) {
        res.status(400).json({ error: 'Файл не получен' });
        return;
    }
    const driverProfile = (0, userService_1.getDriverProfile)(user.telegram_id);
    if (!driverProfile) {
        fs_1.default.unlink(file.path, () => { });
        res.status(403).json({ error: 'Сначала сохраните анкету водителя' });
        return;
    }
    if (driverProfile.photo_path) {
        fs_1.default.unlink(path_1.default.join(upload_1.uploadsDir, driverProfile.photo_path), () => { });
    }
    (0, userService_1.setDriverPhoto)(user.telegram_id, file.filename);
    res.json({ photoUrl: `/uploads/${file.filename}` });
});
