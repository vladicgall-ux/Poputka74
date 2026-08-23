"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApp = createApp;
const express_1 = __importDefault(require("express"));
const path_1 = __importDefault(require("path"));
const users_1 = require("./routes/users");
const rides_1 = require("./routes/rides");
const bookings_1 = require("./routes/bookings");
const admin_1 = require("./routes/admin");
const upload_1 = require("./middleware/upload");
function createApp() {
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    app.use('/api/users', users_1.usersRouter);
    app.use('/api/rides', rides_1.ridesRouter);
    app.use('/api/bookings', bookings_1.bookingsRouter);
    app.use('/api/admin', admin_1.adminRouter);
    app.use('/uploads', express_1.default.static(upload_1.uploadsDir));
    app.use(express_1.default.static(path_1.default.join(__dirname, '..', '..', 'public')));
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    app.use((err, _req, res, _next) => {
        console.error(err);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    });
    return app;
}
