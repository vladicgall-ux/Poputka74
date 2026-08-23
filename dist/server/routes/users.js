"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.usersRouter = void 0;
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const userService_1 = require("../../services/userService");
exports.usersRouter = (0, express_1.Router)();
exports.usersRouter.use(auth_1.requireTelegramAuth);
/** Профиль текущего пользователя: данные аккаунта + анкета водителя (если есть). */
exports.usersRouter.get('/me', (req, res) => {
    const { user } = req;
    const driverProfile = (0, userService_1.getDriverProfile)(user.telegram_id) ?? null;
    res.json({ user, driverProfile });
});
/** Регистрация/обновление анкеты водителя. Требует подтверждённый телефон — защита от фейков. */
exports.usersRouter.post('/me/driver-profile', (req, res) => {
    const { user } = req;
    if (!user.phone_verified) {
        res.status(403).json({ error: 'Сначала подтвердите номер телефона через бота' });
        return;
    }
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
