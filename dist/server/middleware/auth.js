"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SESSION_COOKIE_NAME = void 0;
exports.setSessionCookie = setSessionCookie;
exports.readCookie = readCookie;
exports.requireTelegramAuth = requireTelegramAuth;
exports.requireActiveUser = requireActiveUser;
const telegramAuth_1 = require("../../utils/telegramAuth");
const maxAuth_1 = require("../../utils/maxAuth");
const userService_1 = require("../../services/userService");
const webSessionService_1 = require("../../services/webSessionService");
const config_1 = require("../../config");
exports.SESSION_COOKIE_NAME = 'web_session';
/**
 * Ставит cookie сессии. HttpOnly — токен недоступен из JS, поэтому его
 * не может прочитать ни сторонний скрипт, ни наш собственный код на
 * фронте (секрет сессии там и не нужен). Secure — только по HTTPS.
 * SameSite=Lax — браузер не пошлёт куку в кросс-сайтовых POST-запросах.
 */
function setSessionCookie(res, token) {
    res.cookie(exports.SESSION_COOKIE_NAME, token, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        maxAge: webSessionService_1.SESSION_TTL_MS,
        path: '/',
    });
}
/**
 * Обмен initData на серверную сессию.
 *
 * initData — это подписанный слепок «кто запустил Mini App», а не сессия:
 * он один и тот же на всё время работы приложения и действует ещё
 * config.initDataMaxAgeSec после выдачи. Поэтому сразу после первой
 * успешной проверки подписи заводим обычную серверную сессию, и дальше
 * запросы живут на ней, а не на повторной отправке initData.
 *
 * Если кука уже есть и принадлежит этому же пользователю — ничего не
 * трогаем. Если она чужая или протухла, выдаём новый токен и гасим
 * старый (ротация): идентификатор, который был у браузера до
 * авторизации, не должен оставаться рабочим после неё.
 */
function issueSessionFor(req, res, userId) {
    const existing = readCookie(req, exports.SESSION_COOKIE_NAME);
    if (existing) {
        const current = (0, webSessionService_1.getSessionUser)(existing);
        if (current && current.telegram_id === userId)
            return;
        setSessionCookie(res, (0, webSessionService_1.rotateWebSession)(existing, userId));
        return;
    }
    setSessionCookie(res, (0, webSessionService_1.createWebSession)(userId));
}
/** Простой разбор Cookie-заголовка — одна ожидаемая кука, тащить ради
 *  неё зависимость cookie-parser не нужно. */
function readCookie(req, name) {
    const header = req.header('Cookie');
    if (!header)
        return undefined;
    for (const part of header.split(';')) {
        const eq = part.indexOf('=');
        if (eq === -1)
            continue;
        if (part.slice(0, eq).trim() === name) {
            return decodeURIComponent(part.slice(eq + 1).trim());
        }
    }
    return undefined;
}
/**
 * Принимает initData либо из Telegram (заголовок X-Telegram-Init-Data,
 * window.Telegram.WebApp.initData), либо из MAX (заголовок X-Max-Init-Data,
 * window.WebApp.initData через MAX Bridge) — это авторизация внутри Mini
 * App. Вне Mini App (обычный браузер на ПК/телефоне) initData нет вовсе —
 * там используется cookie-сессия, выданная после входа через Telegram
 * Login Widget или код в чате с ботом MAX (см. server/routes/auth.ts).
 * Один из трёх способов должен сработать — иначе запрос отклоняется.
 */
function requireTelegramAuth(req, res, next) {
    const telegramInitData = req.header('X-Telegram-Init-Data') ?? '';
    const validatedTelegram = (0, telegramAuth_1.validateInitData)(telegramInitData);
    if (validatedTelegram) {
        const user = (0, userService_1.upsertUser)(validatedTelegram.user);
        req.user = (0, userService_1.getUser)(user.telegram_id);
        // initData проверена — заводим серверную сессию, дальше запросы
        // пойдут по ней (см. issueSessionFor).
        issueSessionFor(req, res, user.telegram_id);
        next();
        return;
    }
    const maxInitData = req.header('X-Max-Init-Data') ?? '';
    const validatedMax = (0, maxAuth_1.validateMaxInitData)(maxInitData);
    if (validatedMax) {
        const user = (0, userService_1.upsertMaxUser)(validatedMax.user);
        req.user = (0, userService_1.getUser)(user.telegram_id);
        issueSessionFor(req, res, user.telegram_id);
        next();
        return;
    }
    const sessionToken = readCookie(req, exports.SESSION_COOKIE_NAME);
    const sessionUser = sessionToken ? (0, webSessionService_1.getSessionUser)(sessionToken) : undefined;
    if (sessionUser) {
        req.user = sessionUser;
        next();
        return;
    }
    res.status(401).json({ error: 'Недействительные данные авторизации' });
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
