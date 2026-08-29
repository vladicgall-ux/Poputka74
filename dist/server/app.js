"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApp = createApp;
const express_1 = __importDefault(require("express"));
const path_1 = __importDefault(require("path"));
const helmet_1 = __importDefault(require("helmet"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const users_1 = require("./routes/users");
const rides_1 = require("./routes/rides");
const bookings_1 = require("./routes/bookings");
const admin_1 = require("./routes/admin");
const support_1 = require("./routes/support");
const ratings_1 = require("./routes/ratings");
const auth_1 = require("./routes/auth");
const upload_1 = require("./middleware/upload");
const notifier_1 = require("../bot/notifier");
const config_1 = require("../config");
function createApp() {
    const app = (0, express_1.default)();
    // bothost и подобные PaaS обычно ставят приложение за обратный прокси —
    // без этого req.ip будет адресом прокси, и IP-лимитеры/логи будут бесполезны.
    app.set('trust proxy', 1);
    app.use((0, helmet_1.default)({
        // Mini App должен встраиваться Telegram (в т.ч. в iframe на web.telegram.org) —
        // стандартный X-Frame-Options: SAMEORIGIN это ломает.
        frameguard: false,
        // CSP: дефолты helmet уже допускают инлайн-style (style-src включает
        // 'unsafe-inline' по умолчанию — вёрстка с inline style="..." не
        // ломается), поэтому здесь переопределяем только три директивы:
        // - script-src: по умолчанию только 'self', добавляем CDN Telegram и
        //   MAX — оттуда грузятся мостовые скрипты платформ (<script src=...>
        //   в index.html). Инлайн-<script> в приложении нет вообще (все
        //   обработчики через addEventListener в app.js), так что 'self' + эти
        //   два домена — и никакой сторонний/инжектированный скрипт (например,
        //   через XSS, если где-то пропущен escapeHtml) выполниться не сможет.
        // - img-src: по умолчанию 'self' и data: — добавляем blob:, он нужен
        //   для превью выбранного файла перед загрузкой (URL.createObjectURL).
        // - frame-ancestors: у helmet по умолчанию 'self', что запретило бы
        //   Telegram/MAX встраивать Mini App в свой WebView/iframe — убираем
        //   директиву совсем (null), это то же поведение, что и раньше при
        //   полностью выключенном CSP.
        contentSecurityPolicy: {
            directives: {
                scriptSrc: ["'self'", 'https://telegram.org', 'https://st.max.ru'],
                imgSrc: ["'self'", 'data:', 'blob:'],
                frameAncestors: null,
            },
        },
        // По умолчанию helmet ставит Referrer-Policy: no-referrer — из-за этого
        // браузер не передаёт заголовок Referer при обращении Telegram Login
        // Widget к oauth.telegram.org, а Telegram сверяет домен именно по нему.
        // Без реферера виджет всегда отвечает "Bot domain invalid", даже если
        // домен в BotFather прописан верно. strict-origin-when-cross-origin —
        // это и есть современный дефолт браузеров: отдаёт origin (без пути)
        // на чужие HTTPS-домены, этого достаточно для проверки Telegram.
        referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
        // Cross-Origin-Opener-Policy: same-origin (дефолт helmet) изолирует
        // всплывающее окно/попап от родительской страницы, обрывая
        // window.opener — именно на нём построены такие OAuth/login-виджеты,
        // как у Telegram и Google. Без этого виджет не может сообщить
        // странице результат входа и выглядит как постоянная ошибка домена.
        crossOriginOpenerPolicy: false,
    }));
    // Ограничиваем размер тела запроса — иначе один клиент может прислать
    // гигантский JSON и занять память/CPU процесса на его разборе.
    app.use(express_1.default.json({ limit: '100kb' }));
    // Базовая защита от флуда на уровне IP для всего приложения (включая статику).
    app.use((0, express_rate_limit_1.default)({
        windowMs: 60000,
        max: 300,
        standardHeaders: true,
        legacyHeaders: false,
    }));
    // Более строгий лимит на API — запросы сюда всегда бьют в БД (better-sqlite3
    // синхронный, так что каждый запрос блокирует event loop на время выполнения).
    app.use('/api', (0, express_rate_limit_1.default)({
        windowMs: 60000,
        max: 120,
        standardHeaders: true,
        legacyHeaders: false,
    }));
    // Публичный, без авторизации — нужен фронтенду только чтобы собрать
    // ссылку-приглашение t.me/<бот>, никаких приватных данных не отдаёт.
    app.get('/api/config', (_req, res) => {
        res.json({ botUsername: (0, notifier_1.getBotUsername)(), appVersion: config_1.config.appVersion });
    });
    app.use('/api/auth', auth_1.authRouter);
    app.use('/api/users', users_1.usersRouter);
    app.use('/api/rides', rides_1.ridesRouter);
    app.use('/api/bookings', bookings_1.bookingsRouter);
    app.use('/api/admin', admin_1.adminRouter);
    app.use('/api/support', support_1.supportRouter);
    app.use('/api/ratings', ratings_1.ratingsRouter);
    app.use('/uploads', express_1.default.static(upload_1.uploadsDir));
    app.use(express_1.default.static(path_1.default.join(__dirname, '..', '..', 'public'), {
        setHeaders: (res, filePath) => {
            // index.html не кэшируем вовсе — иначе Telegram/MAX клиент годами
            // показывает старую версию Mini App внутри своего WebView.
            if (filePath.endsWith('index.html')) {
                res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            }
            else if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
                // app.js/styles.css подключаются из index.html с ?v=NN — при любом
                // изменении файла версия в разметке бампается вручную, то есть
                // URL меняется. Раз URL всегда новый при реальном изменении,
                // можно кэшировать текущий URL надолго и не тратить время на
                // повторную загрузку при каждом открытии.
                res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
            }
        },
    }));
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    app.use((err, _req, res, _next) => {
        console.error(err);
        // body-parser и подобные middleware кладут осмысленный статус (напр. 413
        // при превышении лимита размера тела) в err.status/err.statusCode —
        // уважаем его вместо того, чтобы всегда отвечать 500.
        const withStatus = err;
        const status = typeof withStatus?.status === 'number'
            ? withStatus.status
            : typeof withStatus?.statusCode === 'number'
                ? withStatus.statusCode
                : 500;
        const message = status === 413 ? 'Слишком большой запрос' : 'Внутренняя ошибка сервера';
        res.status(status >= 400 && status < 600 ? status : 500).json({ error: message });
    });
    return app;
}
