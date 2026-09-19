"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateInitData = validateInitData;
const crypto_1 = __importDefault(require("crypto"));
const config_1 = require("../config");
const initDataParser_1 = require("./initDataParser");
/**
 * Проверяет подпись initData, которую Telegram Mini App передаёт на бэкенд.
 * Алгоритм из официальной документации Telegram (валидация Web App данных):
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * Разбор строки вынесен в initDataParser: там же проверяются размер,
 * кодировка, обязательные поля, дубликаты security-критичных параметров и
 * срок годности auth_date — всё это до вычисления HMAC, чтобы подпись
 * считалась только по данным заведомо понятной структуры.
 *
 * initData — не сессия. После успешной проверки вызывающий код выдаёт
 * серверную сессию (server/middleware/auth.ts), а окно годности самой
 * initData ограничено config.initDataMaxAgeSec.
 */
function validateInitData(initData) {
    const parsed = (0, initDataParser_1.parseInitData)(initData, config_1.config.initDataMaxAgeSec);
    if (!parsed.ok)
        return null;
    const secretKey = crypto_1.default.createHmac('sha256', 'WebAppData').update(config_1.config.botToken).digest();
    const computedHash = crypto_1.default.createHmac('sha256', secretKey).update(parsed.dataCheckString).digest('hex');
    if (!timingSafeEqualHex(computedHash, parsed.hash)) {
        return null;
    }
    let profile;
    try {
        profile = JSON.parse(parsed.userRaw);
    }
    catch {
        return null;
    }
    if (!profile ||
        typeof profile !== 'object' ||
        typeof profile.id !== 'number' ||
        !Number.isSafeInteger(profile.id) ||
        profile.id <= 0 ||
        typeof profile.first_name !== 'string') {
        return null;
    }
    return { user: profile, authDate: parsed.authDate };
}
function timingSafeEqualHex(a, b) {
    const bufA = Buffer.from(a, 'hex');
    const bufB = Buffer.from(b, 'hex');
    if (bufA.length !== bufB.length)
        return false;
    return crypto_1.default.timingSafeEqual(bufA, bufB);
}
