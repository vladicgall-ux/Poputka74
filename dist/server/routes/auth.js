"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRouter = void 0;
const express_1 = require("express");
const userService_1 = require("../../services/userService");
const webSessionService_1 = require("../../services/webSessionService");
const rateLimit_1 = require("../middleware/rateLimit");
const auth_1 = require("../middleware/auth");
exports.authRouter = (0, express_1.Router)();
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
exports.authRouter.post('/login-code/status', (0, rateLimit_1.writeLimiter)(240, 10 * 60000), (req, res) => {
    // POST, а не GET, и с проверкой источника запроса. Этот эндпоинт не
    // просто читает состояние: он гасит код (used_at), заводит сессию и
    // ставит cookie. Пока это был GET с параметрами в строке запроса, на
    // него можно было завести жертву обычной ссылкой — и её браузер получал
    // cookie сессии ЧУЖОГО аккаунта (атакующий заранее подтверждал свой код
    // со своего аккаунта). Дальше жертва в полной уверенности, что она у
    // себя, вводила своё настоящее имя, бронировала поездки и писала в
    // поддержку — всё это попадало в аккаунт атакующего.
    //
    // SameSite=Lax тут не спасал: он ограничивает ОТПРАВКУ cookie, а здесь
    // cookie именно устанавливается. Sec-Fetch-Site шлют все актуальные
    // браузеры; если заголовка нет вовсе (совсем старый клиент), не
    // блокируем — POST + отсутствие CORS уже отсекают основной сценарий.
    const site = req.header('Sec-Fetch-Site');
    if (site && site !== 'same-origin' && site !== 'none') {
        res.status(403).json({ error: 'Запрос отклонён: вход должен начинаться на этом же сайте' });
        return;
    }
    const code = typeof req.body?.code === 'string' ? req.body.code : '';
    const pollToken = typeof req.body?.pollToken === 'string' ? req.body.pollToken : '';
    const userId = code && pollToken ? (0, webSessionService_1.checkLoginCode)(code, pollToken) : null;
    if (!userId) {
        res.json({ ok: false });
        return;
    }
    // Гасим токен, который был у этого браузера до входа: иначе он
    // остался бы действительным в БД и дальше (защита от фиксации сессии).
    const previous = (0, auth_1.readCookie)(req, auth_1.SESSION_COOKIE_NAME);
    if (previous)
        (0, webSessionService_1.deleteWebSession)(previous);
    const token = (0, webSessionService_1.createWebSession)(userId);
    (0, auth_1.setSessionCookie)(res, token);
    res.json({ ok: true, user: (0, userService_1.getUser)(userId) });
});
exports.authRouter.post('/logout', (req, res) => {
    const token = (0, auth_1.readCookie)(req, auth_1.SESSION_COOKIE_NAME);
    if (token)
        (0, webSessionService_1.deleteWebSession)(token);
    res.clearCookie(auth_1.SESSION_COOKIE_NAME, { path: '/' });
    res.json({ ok: true });
});
/**
 * «Выйти со всех устройств» — обрывает все веб-сессии пользователя (все
 * браузеры, где он входил по коду в чате с ботом), не только текущую.
 * Работает и из Mini App (initData), и из браузерной сессии (cookie) —
 * requireTelegramAuth принимает оба способа и уже определяет user.
 */
exports.authRouter.post('/logout-all', (0, rateLimit_1.writeLimiter)(20, 10 * 60000), auth_1.requireTelegramAuth, (req, res) => {
    const { user } = req;
    (0, webSessionService_1.deleteAllWebSessionsForUser)(user.telegram_id);
    res.clearCookie(auth_1.SESSION_COOKIE_NAME, { path: '/' });
    res.json({ ok: true });
});
