"use strict";
/**
 * Строгий разбор initData (Telegram Mini App и MAX Mini App — формат у них
 * одинаковый: query-строка, где параметр hash содержит HMAC-подпись
 * остальных полей).
 *
 * Зачем свой разбор вместо URLSearchParams. URLSearchParams принимает
 * что угодно и молча сглаживает проблемы: дубликаты параметров он хранит
 * все, но .get() отдаёт первый; битую процентную кодировку не считает
 * ошибкой; длину не ограничивает. Проверять подпись имеет смысл только
 * по данным, в структуре которых мы уверены, поэтому всё, что выглядит
 * неоднозначно, отвергаем до вычисления HMAC.
 *
 * Отдельно про дубликаты security-критичных параметров. Сегодня подсунуть
 * второй hash или второй auth_date и пройти проверку нельзя: строка
 * data-check-string собирается из ВСЕХ пар, поэтому лишний параметр ломает
 * подпись. То есть это не закрытая дыра, а страховка на случай, если
 * сборка data-check-string когда-нибудь изменится — тогда расхождение
 * между «каким параметром подписались» и «какой параметр прочитали»
 * стало бы настоящей уязвимостью. Стоит дёшево, поэтому проверяем явно.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CLOCK_SKEW_SEC = exports.INIT_DATA_MAX_LENGTH = void 0;
exports.parseInitData = parseInitData;
/** Верхняя граница размера. Реальная initData — это сотни байт; всё,
 *  что заметно больше, разбирать незачем. */
exports.INIT_DATA_MAX_LENGTH = 4096;
/** Допустимое расхождение часов клиента и сервера «вперёд». Без верхней
 *  границы данные с датой из будущего не устаревали бы никогда. */
exports.CLOCK_SKEW_SEC = 300;
/** Параметры, от которых зависит решение «кто этот пользователь» и
 *  «валидны ли данные». Каждый должен встречаться ровно один раз. */
const SECURITY_CRITICAL_KEYS = ['hash', 'signature', 'auth_date', 'user'];
/**
 * Декодирует компонент query-строки так же, как это делает
 * URLSearchParams: '+' означает пробел, остальное — процентная кодировка.
 * Совместимость здесь важна — по этим значениям считается подпись, и
 * любое расхождение с прежним поведением сломало бы вход всем сразу.
 */
function decodeComponent(value) {
    try {
        return decodeURIComponent(value.replace(/\+/g, ' '));
    }
    catch {
        // Битая процентная последовательность вроде '%zz' или обрезанного '%e0'.
        return null;
    }
}
function parseInitData(initData, maxAgeSec, nowMs = Date.now()) {
    if (typeof initData !== 'string' || initData.length === 0) {
        return { ok: false, reason: 'пусто или не строка' };
    }
    if (initData.length > exports.INIT_DATA_MAX_LENGTH) {
        return { ok: false, reason: 'слишком длинная initData' };
    }
    const pairs = [];
    const seen = new Map();
    for (const chunk of initData.split('&')) {
        if (chunk === '')
            continue;
        const eq = chunk.indexOf('=');
        if (eq <= 0) {
            // Либо нет '=', либо пустое имя параметра.
            return { ok: false, reason: 'некорректная пара ключ=значение' };
        }
        const key = decodeComponent(chunk.slice(0, eq));
        const value = decodeComponent(chunk.slice(eq + 1));
        if (key === null || value === null) {
            return { ok: false, reason: 'некорректная процентная кодировка' };
        }
        seen.set(key, (seen.get(key) ?? 0) + 1);
        pairs.push([key, value]);
    }
    for (const key of SECURITY_CRITICAL_KEYS) {
        if ((seen.get(key) ?? 0) > 1) {
            return { ok: false, reason: `дубликат параметра ${key}` };
        }
    }
    const get = (key) => pairs.find(([k]) => k === key)?.[1];
    const hash = get('hash');
    if (!hash)
        return { ok: false, reason: 'нет hash' };
    // Подпись — это ровно 32 байта в hex. Проверяем форму заранее, чтобы
    // не передавать в сравнение заведомый мусор.
    if (!/^[0-9a-f]{64}$/i.test(hash)) {
        return { ok: false, reason: 'hash неверного формата' };
    }
    const authDateRaw = get('auth_date');
    if (!authDateRaw)
        return { ok: false, reason: 'нет auth_date' };
    if (!/^\d{1,10}$/.test(authDateRaw)) {
        return { ok: false, reason: 'auth_date неверного формата' };
    }
    const authDate = Number(authDateRaw);
    const nowSec = nowMs / 1000;
    if (authDate <= 0) {
        return { ok: false, reason: 'auth_date вне допустимых значений' };
    }
    if (authDate > nowSec + exports.CLOCK_SKEW_SEC) {
        return { ok: false, reason: 'auth_date из будущего' };
    }
    if (nowSec - authDate > maxAgeSec) {
        return { ok: false, reason: 'initData просрочена' };
    }
    const userRaw = get('user');
    if (!userRaw)
        return { ok: false, reason: 'нет user' };
    // Сортировка по кодовым точкам, а не localeCompare: у localeCompare
    // порядок зависит от локали среды, а подпись должна считаться
    // одинаково на любой машине. Ключи здесь — ASCII в нижнем регистре
    // (auth_date, chat_instance, query_id, signature, user), так что
    // результат совпадает с прежним, но больше не зависит от окружения.
    const dataCheckString = pairs
        .filter(([key]) => key !== 'hash')
        .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');
    return { ok: true, dataCheckString, hash, authDate, userRaw };
}
