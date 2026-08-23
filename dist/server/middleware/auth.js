"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireTelegramAuth = requireTelegramAuth;
const telegramAuth_1 = require("../../utils/telegramAuth");
const userService_1 = require("../../services/userService");
/**
 * Ожидает заголовок X-Telegram-Init-Data с сырой строкой initData,
 * которую фронтенд Mini App получает из window.Telegram.WebApp.initData.
 * Это единственный способ авторизации в API — так исключаются
 * подделанные запросы от имени чужого telegram_id.
 */
function requireTelegramAuth(req, res, next) {
    const initData = req.header('X-Telegram-Init-Data') ?? '';
    const validated = (0, telegramAuth_1.validateInitData)(initData);
    if (!validated) {
        res.status(401).json({ error: 'Недействительные данные авторизации Telegram' });
        return;
    }
    const user = (0, userService_1.upsertUser)(validated.user);
    req.user = (0, userService_1.getUser)(user.telegram_id);
    next();
}
