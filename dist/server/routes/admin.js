"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminRouter = void 0;
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const config_1 = require("../../config");
const userService_1 = require("../../services/userService");
const rideService_1 = require("../../services/rideService");
const bookingService_1 = require("../../services/bookingService");
const supportService_1 = require("../../services/supportService");
const statsService_1 = require("../../services/statsService");
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
    await (0, notifier_1.notify)(userId, `✉️ <b>Ответ поддержки</b>\n\n${message}`);
    res.status(201).json({ message: record });
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
