"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminRouter = void 0;
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const config_1 = require("../../config");
const userService_1 = require("../../services/userService");
const rideService_1 = require("../../services/rideService");
const bookingService_1 = require("../../services/bookingService");
exports.adminRouter = (0, express_1.Router)();
exports.adminRouter.use(auth_1.requireTelegramAuth);
exports.adminRouter.use((req, res, next) => {
    const { user } = req;
    if (!config_1.config.adminIds.includes(user.telegram_id)) {
        res.status(403).json({ error: 'Доступ только для администраторов' });
        return;
    }
    next();
});
exports.adminRouter.get('/users', (_req, res) => {
    res.json({ users: (0, userService_1.listAllUsers)() });
});
exports.adminRouter.get('/rides', (_req, res) => {
    res.json({ rides: (0, rideService_1.listAllRides)() });
});
exports.adminRouter.get('/bookings', (_req, res) => {
    res.json({ bookings: (0, bookingService_1.listAllBookings)() });
});
