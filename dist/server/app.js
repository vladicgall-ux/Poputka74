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
const upload_1 = require("./middleware/upload");
function createApp() {
    const app = (0, express_1.default)();
    // bothost и подобные PaaS обычно ставят приложение за обратный прокси —
    // без этого req.ip будет адресом прокси, и IP-лимитеры/логи будут бесполезны.
    app.set('trust proxy', 1);
    app.use((0, helmet_1.default)({
        // Mini App должен встраиваться Telegram (в т.ч. в iframe на web.telegram.org) —
        // стандартный X-Frame-Options: SAMEORIGIN это ломает.
        frameguard: false,
        // Строгий CSP без 'unsafe-inline' сломает существующую вёрстку (inline style=...),
        // а тестировать реальный Telegram WebView здесь негде — оставляем выключенным,
        // остальные защитные заголовки helmet (nosniff, HSTS, скрытие X-Powered-By и т.д.)
        // включены и работают.
        contentSecurityPolicy: false,
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
    app.use('/api/users', users_1.usersRouter);
    app.use('/api/rides', rides_1.ridesRouter);
    app.use('/api/bookings', bookings_1.bookingsRouter);
    app.use('/api/admin', admin_1.adminRouter);
    app.use('/api/support', support_1.supportRouter);
    app.use('/api/ratings', ratings_1.ratingsRouter);
    app.use('/uploads', express_1.default.static(upload_1.uploadsDir));
    app.use(express_1.default.static(path_1.default.join(__dirname, '..', '..', 'public'), {
        setHeaders: (res, filePath) => {
            // index.html не кэшируем вовсе — иначе Telegram-клиент годами
            // показывает старую версию Mini App внутри своего WebView.
            if (filePath.endsWith('index.html')) {
                res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
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
