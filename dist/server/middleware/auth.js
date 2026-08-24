"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireTelegramAuth = requireTelegramAuth;
exports.requireActiveUser = requireActiveUser;
const telegramAuth_1 = require("../../utils/telegramAuth");
const userService_1 = require("../../services/userService");
const config_1 = require("../../config");
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
/**
 * Полностью закрывает доступ к разделу (поиск/бронирование/публикация поездок)
 * забаненным и неверифицированным пользователям — не только запись, но и чтение.
 * Ставится после requireTelegramAuth. GET /api/users/me этой проверкой
 * НЕ прикрыт намеренно — фронтенду нужно узнать статус, чтобы показать экран блокировки.
 */
function requireActiveUser(req, res, next) {
    const { user } = req;
    if (config_1.config.adminIds.includes(user.telegram_id)) {
        // Админы не должны иметь возможность случайно заблокировать себе доступ
        // к собственной панели, отозвав себе телефон или забанив самих себя.
        next();
        return;
    }
    if (user.banned) {
        res.status(403).json({ error: 'Ваш аккаунт заблокирован администратором', banned: true });
        return;
    }
    if (!user.phone_verified) {
        res.status(403).json({ error: 'Подтвердите номер телефона в чате с ботом', phoneRequired: true });
        return;
    }
    if (!user.full_name) {
        res.status(403).json({ error: 'Укажите имя и фамилию', nameRequired: true });
        return;
    }
    next();
}
