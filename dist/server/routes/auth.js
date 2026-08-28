"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRouter = void 0;
const express_1 = require("express");
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
 * Вход через браузерную версию сайта (вне Mini App): ни у Telegram (классический
 * Login Widget отключён самим Telegram), ни у MAX нет рабочего публичного
 * login-виджета/OAuth для сторонних сайтов — вместо этого выдаём код,
 * который пользователь присылает боту в чат (Telegram или MAX, любой).
 */
exports.authRouter.post('/login-code/start', (0, rateLimit_1.writeLimiter)(10, 10 * 60000), (req, res) => {
    const { code, pollToken } = (0, webSessionService_1.createLoginCode)();
    res.json({ code, pollToken, expiresInSec: 600 });
});
/**
 * Фронтенд опрашивает этот эндпоинт, пока пользователь не пришлёт код боту.
 * Лимитер — защита от перебора: без него код всего в 6 цифр можно было бы
 * перебрать полностью за разумное время. pollToken (см. webSessionService)
 * закрывает саму возможность перебора по коду, лимитер — на всякий случай,
 * второй эшелон защиты.
 */
exports.authRouter.get('/login-code/status', (0, rateLimit_1.writeLimiter)(240, 10 * 60000), (req, res) => {
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const pollToken = typeof req.query.pollToken === 'string' ? req.query.pollToken : '';
    const userId = code && pollToken ? (0, webSessionService_1.checkLoginCode)(code, pollToken) : null;
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
