"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminRouter = void 0;
const express_1 = require("express");
const fs_1 = __importDefault(require("fs"));
const auth_1 = require("../middleware/auth");
const rateLimit_1 = require("../middleware/rateLimit");
const upload_1 = require("../middleware/upload");
const config_1 = require("../../config");
const userService_1 = require("../../services/userService");
const rideService_1 = require("../../services/rideService");
const bookingService_1 = require("../../services/bookingService");
const supportService_1 = require("../../services/supportService");
const statsService_1 = require("../../services/statsService");
const ratingService_1 = require("../../services/ratingService");
const notifier_1 = require("../../bot/notifier");
exports.adminRouter = (0, express_1.Router)();
exports.adminRouter.use(auth_1.requireTelegramAuth);
exports.adminRouter.use((req, res, next) => {
    const { user } = req;
    if (!config_1.config.adminIds.includes(user.telegram_id)) {
        res.status(403).json({ error: 'Доступ только для администраторов' });
        return;
    }
    next();
});
exports.adminRouter.get('/stats', (_req, res) => {
    res.json({ stats: (0, statsService_1.getAdminStats)() });
});
exports.adminRouter.get('/users', (_req, res) => {
    res.json({ users: (0, userService_1.listAllUsers)() });
});
/** Подробная карточка пользователя для админки: поездки, брони, статистика за всё время. */
exports.adminRouter.get('/users/:id', (req, res) => {
    const telegramId = Number(req.params.id);
    const user = (0, userService_1.getUser)(telegramId);
    if (!user) {
        res.status(404).json({ error: 'Пользователь не найден' });
        return;
    }
    const driverProfile = (0, userService_1.getDriverProfile)(telegramId) ?? null;
    const rides = driverProfile ? (0, rideService_1.listRidesByDriver)(telegramId) : [];
    const driverStats = driverProfile ? (0, statsService_1.getDriverAllTimeStats)(telegramId) : null;
    const rating = driverProfile ? (0, ratingService_1.getDriverRatingSummary)(telegramId) : null;
    const bookings = (0, bookingService_1.listBookingsByPassenger)(telegramId);
    const passengerStats = (0, statsService_1.getPassengerAllTimeStats)(telegramId);
    const passengerRating = (0, ratingService_1.getPassengerRatingSummary)(telegramId);
    // Сигнал для модерации: сколько раз пользователь сам отменял брони/поездки.
    const cancelledBookingsCount = (0, bookingService_1.countCancelledBookingsByPassenger)(telegramId);
    const cancelledRidesCount = driverProfile ? (0, rideService_1.countCancelledRidesByDriver)(telegramId) : 0;
    res.json({
        user,
        driverProfile,
        rides,
        driverStats,
        rating,
        bookings,
        passengerStats,
        passengerRating,
        cancelledBookingsCount,
        cancelledRidesCount,
    });
});
exports.adminRouter.get('/rides', (_req, res) => {
    res.json({ rides: (0, rideService_1.listAllRides)() });
});
exports.adminRouter.get('/bookings', (_req, res) => {
    res.json({ bookings: (0, bookingService_1.listAllBookings)() });
});
exports.adminRouter.get('/support', (_req, res) => {
    res.json({ messages: (0, supportService_1.listAllSupportMessages)() });
});
/** Ответ администратора пользователю — уходит ему сообщением от бота. */
exports.adminRouter.post('/support/:userId/reply', async (req, res) => {
    const userId = Number(req.params.userId);
    const message = typeof req.body?.message === 'string' ? req.body.message.trim().slice(0, 1000) : '';
    if (!message) {
        res.status(400).json({ error: 'Введите текст ответа' });
        return;
    }
    const target = (0, userService_1.getUser)(userId);
    if (!target) {
        res.status(404).json({ error: 'Пользователь не найден' });
        return;
    }
    const record = (0, supportService_1.createAdminReply)(userId, message);
    await (0, notifier_1.notifyUser)(target, `✉️ <b>Ответ поддержки</b>\n\n${message}`);
    res.status(201).json({ message: record });
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/**
 * Массовая рассылка всем незаблокированным пользователям от имени бота
 * (не от личного аккаунта админа). Текст и/или фото — нужно хотя бы одно.
 * Шлём последовательно с небольшой паузой, чтобы не упереться в лимит
 * Telegram (~30 сообщений/сек на бота).
 */
exports.adminRouter.post('/broadcast', (0, rateLimit_1.writeLimiter)(5, 60 * 60000), (req, res, next) => {
    upload_1.uploadBroadcastPhoto.single('photo')(req, res, (err) => {
        if (err) {
            res.status(400).json({ error: err instanceof Error ? err.message : 'Не удалось загрузить фото' });
            return;
        }
        next();
    });
}, async (req, res) => {
    const message = typeof req.body?.message === 'string' ? req.body.message.trim().slice(0, 1000) : '';
    const file = req.file;
    // multipart/form-data — значения всегда строки, не булевы.
    const pin = req.body?.pin === 'true' || req.body?.pin === '1';
    if (!message && !file) {
        res.status(400).json({ error: 'Добавьте текст или фото' });
        return;
    }
    const recipients = (0, userService_1.listActiveUserIds)();
    let sent = 0;
    for (const telegramId of recipients) {
        const recipient = (0, userService_1.getUser)(telegramId);
        if (!recipient)
            continue;
        // Фото умеем слать только через Telegram — у пользователей MAX пока
        // нет notifyPhoto для этой платформы, поэтому им уходит хотя бы текст,
        // чтобы рассылка не пропадала для них совсем.
        const ok = file && recipient.platform === 'telegram'
            ? await (0, notifier_1.notifyPhoto)(telegramId, file.path, message, pin)
            : await (0, notifier_1.notifyUser)(recipient, message || '📷 Новое объявление от Поехали 74', undefined, pin);
        if (ok)
            sent += 1;
        await sleep(40);
    }
    if (file) {
        fs_1.default.unlink(file.path, () => { });
    }
    res.json({ sent, total: recipients.length });
});
function setBan(banned) {
    return (req, res) => {
        const telegramId = Number(req.params.id);
        if (config_1.config.adminIds.includes(telegramId)) {
            res.status(400).json({ error: 'Нельзя заблокировать администратора' });
            return;
        }
        const target = (0, userService_1.getUser)(telegramId);
        if (!target) {
            res.status(404).json({ error: 'Пользователь не найден' });
            return;
        }
        (0, userService_1.setUserBanned)(telegramId, banned);
        res.json({ user: (0, userService_1.getUser)(telegramId) });
    };
}
exports.adminRouter.post('/users/:id/ban', setBan(true));
exports.adminRouter.post('/users/:id/unban', setBan(false));
