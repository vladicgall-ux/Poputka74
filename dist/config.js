"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
function required(name, fallback) {
    const value = process.env[name] ?? fallback;
    if (!value) {
        throw new Error(`Не задана переменная окружения ${name}. Смотрите .env.example`);
    }
    return value;
}
const webappUrlRaw = (process.env.WEBAPP_URL ?? '').trim();
const maxBotTokenRaw = (process.env.MAX_BOT_TOKEN ?? '').trim();
exports.config = {
    botToken: required('BOT_TOKEN'),
    // Не обязателен на старте: пока не известен публичный HTTPS-домен
    // (например, только разворачиваетесь на bothost и ждёте домен),
    // бот должен запускаться и работать, просто без кнопки Mini App.
    webappUrl: webappUrlRaw.startsWith('https://') ? webappUrlRaw : undefined,
    // Бот MAX опционален и полностью отключён, пока переменная не задана —
    // не должен мешать уже работающему боту Telegram, если что-то пойдёт не так.
    maxBotToken: maxBotTokenRaw || undefined,
    port: Number(process.env.PORT ?? 3000),
    adminIds: (process.env.ADMIN_IDS ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map(Number),
    dbPath: process.env.DB_PATH ?? './data/poputka74.db',
    /**
     * Сколько секунд initData считается действительной.
     *
     * Было 24 часа — это окно, в течение которого один раз перехваченная
     * или пересланная initData продолжает открывать доступ к аккаунту.
     * Час — обычное production-значение: Mini App получает свежую initData
     * при каждом запуске, а для долгой работы внутри приложения initData
     * больше не нужна, потому что после первой проверки выдаётся серверная
     * сессия (см. server/middleware/auth.ts).
     */
    initDataMaxAgeSec: Number(process.env.INIT_DATA_MAX_AGE_SEC ?? 3600),
    /**
     * Сколько дней живёт серверная сессия. Было 30 — многовато для
     * сессии, которую выдают по коду из чата; неделя закрывает обычный
     * сценарий «зашёл с того же браузера на следующий день».
     */
    sessionTtlDays: Number(process.env.SESSION_TTL_DAYS ?? 7),
    /**
     * Сколько обратных прокси стоит перед приложением. Express берёт
     * req.ip из X-Forwarded-For, отсчитывая столько «доверенных» хопов
     * справа — значение обязано совпадать с реальной схемой развёртывания,
     * иначе req.ip станет адресом, который прислал сам клиент.
     * 0 — прокси нет, брать адрес сокета.
     */
    trustProxy: Number(process.env.TRUST_PROXY ?? 1),
    cities: ['Челябинск', 'Кунашак', 'Аргаяш'],
    // Бампается вручную вместе с ?v=NN у app.js/styles.css в public/index.html.
    // Клиент сверяет это значение при загрузке и сам перезагружает страницу,
    // если у пользователя в кэше/WebView застряла старая версия.
    appVersion: '64',
};
