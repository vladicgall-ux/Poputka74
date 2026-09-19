"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateMaxInitData = validateMaxInitData;
const crypto_1 = __importDefault(require("crypto"));
const config_1 = require("../config");
const initDataParser_1 = require("./initDataParser");
/**
 * Проверяет подпись initData из MAX Mini App.
 *
 * Алгоритм подтверждён официальной документацией MAX (dev.max.ru/docs/
 * webapps/validation): та же схема, что и у Telegram Mini Apps —
 * HMAC-SHA256 от отсортированной data-check-string, ключ —
 * HMAC-SHA256('WebAppData', токен бота). Реализация ниже совпадает с
 * validateInitData в telegramAuth.ts, только с секретом MAX-бота, и
 * использует тот же строгий разбор (initDataParser): размер, кодировка,
 * обязательные поля, дубликаты security-критичных параметров, срок
 * годности auth_date и допуск на расхождение часов.
 *
 * Launch-параметры MAX — не постоянный API-токен: после успешной проверки
 * выдаётся серверная сессия в HttpOnly-куке (server/middleware/auth.ts),
 * а сами параметры живут не дольше config.initDataMaxAgeSec.
 */
function validateMaxInitData(initData) {
    // Логируем только короткую причину отказа, без самих данных — initData
    // содержит персональные данные пользователя MAX (id, имя, username), а
    // при неверной подписи ещё и посчитанный HMAC незачем писать в лог.
    const log = (reason) => console.log(`[maxAuth] отклонено: ${reason}`);
    // Пустой X-Max-Init-Data — это НЕ аномалия, а норма для подавляющего
    // большинства запросов: requireTelegramAuth вызывает эту функцию как
    // запасной вариант для КАЖДОГО запроса, у которого не прошла телеграмная
    // проверка, — а это в том числе и весь трафик браузерной версии сайта
    // (вход по коду, там нет ни Telegram, ни MAX initData вообще), и запросы
    // ботов/краулеров без какого-либо игрового контекста. Логировать здесь
    // значило бы писать в лог фактически на каждый обычный запрос сайта.
    if (!initData) {
        return null;
    }
    if (!config_1.config.maxBotToken) {
        log('MAX_BOT_TOKEN не задан на сервере');
        return null;
    }
    const parsed = (0, initDataParser_1.parseInitData)(initData, config_1.config.initDataMaxAgeSec);
    if (!parsed.ok) {
        log(parsed.reason);
        return null;
    }
    const secretKey = crypto_1.default.createHmac('sha256', 'WebAppData').update(config_1.config.maxBotToken).digest();
    const computedHash = crypto_1.default.createHmac('sha256', secretKey).update(parsed.dataCheckString).digest('hex');
    if (!timingSafeEqualHex(computedHash, parsed.hash)) {
        log('подпись не совпала');
        return null;
    }
    let profile;
    try {
        profile = JSON.parse(parsed.userRaw);
    }
    catch {
        log('поле user — невалидный JSON');
        return null;
    }
    if (!profile ||
        typeof profile !== 'object' ||
        typeof profile.id !== 'number' ||
        !Number.isSafeInteger(profile.id) ||
        profile.id <= 0) {
        log('поле user имеет неверную структуру');
        return null;
    }
    const raw = profile;
    const user = {
        id: raw.id,
        name: raw.name ?? raw.first_name ?? 'Пользователь MAX',
        username: raw.username ?? null,
    };
    return { user, authDate: parsed.authDate };
}
function timingSafeEqualHex(a, b) {
    const bufA = Buffer.from(a, 'hex');
    const bufB = Buffer.from(b, 'hex');
    if (bufA.length !== bufB.length)
        return false;
    return crypto_1.default.timingSafeEqual(bufA, bufB);
}
