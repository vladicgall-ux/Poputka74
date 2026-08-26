"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRouter = void 0;
const express_1 = require("express");
const telegramLoginWidget_1 = require("../../utils/telegramLoginWidget");
const userService_1 = require("../../services/userService");
const webSessionService_1 = require("../../services/webSessionService");
const rateLimit_1 = require("../middleware/rateLimit");
const auth_1 = require("../middleware/auth");
exports.authRouter = (0, express_1.Router)();
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60000; // держим в шаге с TTL сессии в webSessionService
function setSessionCookie(res, token) {
    res.cookie(auth_1.SESSION_COOKIE_NAME, token, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        maxAge: COOKIE_MAX_AGE_MS,
        path: '/',
    });
}
/**
 * Вход через браузерную версию сайта (вне Mini App) по официальному
 * Telegram Login Widget: https://core.telegram.org/widgets/login
 * Фронтенд отдаёт сюда объект, который виджет передал в data-onauth.
 */
exports.authRouter.post('/telegram-widget', (0, rateLimit_1.writeLimiter)(20, 10 * 60000), (req, res) => {
    const body = req.body ?? {};
    const stringified = {};
    for (const key of ['id', 'first_name', 'last_name', 'username', 'photo_url', 'auth_date', 'hash']) {
        if (body[key] !== undefined && body[key] !== null) {
            stringified[key] = String(body[key]);
        }
    }
    const profile = (0, telegramLoginWidget_1.validateLoginWidgetData)(stringified);
    if (!profile) {
        res.status(401).json({ error: 'Не удалось подтвердить вход через Telegram' });
        return;
    }
    const user = (0, userService_1.upsertUser)(profile);
    const token = (0, webSessionService_1.createWebSession)(user.telegram_id);
    setSessionCookie(res, token);
    res.json({ user: (0, userService_1.getUser)(user.telegram_id) });
});
/** Начало входа через MAX: выдаём код, который пользователь пришлёт боту в чат. */
exports.authRouter.post('/max-code/start', (0, rateLimit_1.writeLimiter)(10, 10 * 60000), (req, res) => {
    const code = (0, webSessionService_1.createMaxLoginCode)();
    res.json({ code, expiresInSec: 600 });
});
/** Фронтенд опрашивает этот эндпоинт, пока пользователь не пришлёт код боту в MAX. */
exports.authRouter.get('/max-code/status', (req, res) => {
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const userId = code ? (0, webSessionService_1.checkMaxLoginCode)(code) : null;
    if (!userId) {
        res.json({ ok: false });
        return;
    }
    const token = (0, webSessionService_1.createWebSession)(userId);
    setSessionCookie(res, token);
    res.json({ ok: true, user: (0, userService_1.getUser)(userId) });
});
exports.authRouter.post('/logout', (req, res) => {
    const token = (0, auth_1.readCookie)(req, auth_1.SESSION_COOKIE_NAME);
    if (token)
        (0, webSessionService_1.deleteWebSession)(token);
    res.clearCookie(auth_1.SESSION_COOKIE_NAME, { path: '/' });
    res.json({ ok: true });
});
