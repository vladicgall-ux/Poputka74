"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateMaxInitData = validateMaxInitData;
const crypto_1 = __importDefault(require("crypto"));
const config_1 = require("../config");
/**
 * Проверяет подпись initData из MAX Mini App.
 *
 * ВАЖНО: dev.max.ru (единственный официальный источник точной формулы)
 * был недоступен из этой сессии — сеть блокирует egress на этот домен.
 * Подтверждено из открытых источников только то, что MAX Bridge отдаёт
 * initData тем же набором полей, что и Telegram (query_id, auth_date,
 * hash, user.{id,first_name,last_name,username,language_code,photo_url},
 * start_param) — MAX сознательно скопировал схему Telegram Mini Apps.
 * Поэтому здесь применён ТОТ ЖЕ алгоритм, что и для Telegram
 * (validateInitData в telegramAuth.ts): HMAC-SHA256 от отсортированной
 * data-check-string, ключ — HMAC-SHA256('WebAppData', токен бота).
 *
 * Это лучшее обоснованное предположение, а не подтверждённый факт. Перед
 * тем как полагаться на это в проде, нужно получить реальный initData от
 * живого MAX Mini App (залогировать сырую строку на сервере при первом
 * запросе) и свериться с этой реализацией — если MAX использует другую
 * секретную строку вместо 'WebAppData' или другой набор полей, здесь
 * потребуется только эта константа, остальной алгоритм неизменен.
 */
function validateMaxInitData(initData) {
    if (!initData || !config_1.config.maxBotToken)
        return null;
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash)
        return null;
    params.delete('hash');
    const dataCheckString = [...params.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');
    const secretKey = crypto_1.default.createHmac('sha256', 'WebAppData').update(config_1.config.maxBotToken).digest();
    const computedHash = crypto_1.default.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    if (!timingSafeEqualHex(computedHash, hash)) {
        return null;
    }
    const authDate = Number(params.get('auth_date') ?? 0);
    if (!authDate || Date.now() / 1000 - authDate > 60 * 60 * 24) {
        return null;
    }
    const userRaw = params.get('user');
    if (!userRaw)
        return null;
    const parsed = JSON.parse(userRaw);
    const user = {
        id: parsed.id,
        name: parsed.name ?? parsed.first_name ?? 'Пользователь MAX',
        username: parsed.username ?? null,
    };
    return { user, authDate };
}
function timingSafeEqualHex(a, b) {
    const bufA = Buffer.from(a, 'hex');
    const bufB = Buffer.from(b, 'hex');
    if (bufA.length !== bufB.length)
        return false;
    return crypto_1.default.timingSafeEqual(bufA, bufB);
}
