"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ridesRouter = void 0;
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const userService_1 = require("../../services/userService");
const rideService_1 = require("../../services/rideService");
const config_1 = require("../../config");
exports.ridesRouter = (0, express_1.Router)();
exports.ridesRouter.use(auth_1.requireTelegramAuth, auth_1.requireActiveUser);
function isCity(value) {
    return typeof value === 'string' && config_1.config.cities.includes(value);
}
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Поиск активных поездок, опционально по направлению и дате отправления. */
exports.ridesRouter.get('/', (req, res) => {
    const fromCity = isCity(req.query.from) ? req.query.from : undefined;
    const toCity = isCity(req.query.to) ? req.query.to : undefined;
    const date = typeof req.query.date === 'string' && DATE_RE.test(req.query.date) ? req.query.date : undefined;
    const rides = (0, rideService_1.searchRides)({ fromCity, toCity, date, onlyAvailable: req.query.onlyAvailable === '1' });
    res.json({ rides });
});
/** Поездки текущего водителя. */
exports.ridesRouter.get('/mine', (req, res) => {
    const { user } = req;
    res.json({ rides: (0, rideService_1.listRidesByDriver)(user.telegram_id) });
});
/** Публикация новой поездки. Требует зарегистрированного и верифицированного водителя. */
exports.ridesRouter.post('/', (req, res) => {
    const { user } = req;
    const driverProfile = (0, userService_1.getDriverProfile)(user.telegram_id);
    if (!driverProfile) {
        res.status(403).json({ error: 'Сначала зарегистрируйтесь как водитель' });
        return;
    }
    const { fromCity, toCity, departureAt, pricePerSeat, seatsTotal, comment } = req.body ?? {};
    if (!isCity(fromCity) || !isCity(toCity) || fromCity === toCity) {
        res.status(400).json({ error: 'Некорректное направление поездки' });
        return;
    }
    const departure = new Date(departureAt);
    if (Number.isNaN(departure.getTime()) || departure.getTime() < Date.now() - 60000) {
        res.status(400).json({ error: 'Некорректные дата и время отправления' });
        return;
    }
    const price = Number(pricePerSeat);
    const seats = Number(seatsTotal);
    if (!Number.isInteger(price) || price < 0 || price > 100000) {
        res.status(400).json({ error: 'Некорректная цена за место' });
        return;
    }
    if (!Number.isInteger(seats) || seats < 1 || seats > 8) {
        res.status(400).json({ error: 'Количество мест должно быть от 1 до 8' });
        return;
    }
    const ride = (0, rideService_1.createRide)({
        driverId: user.telegram_id,
        fromCity,
        toCity,
        departureAt: departure.toISOString(),
        pricePerSeat: price,
        seatsTotal: seats,
        comment: typeof comment === 'string' ? comment.trim().slice(0, 300) : undefined,
    });
    res.status(201).json({ ride });
});
/** Отмена поездки водителем. */
exports.ridesRouter.post('/:id/cancel', (req, res) => {
    const { user } = req;
    const rideId = Number(req.params.id);
    const ok = (0, rideService_1.cancelRide)(rideId, user.telegram_id);
    if (!ok) {
        res.status(404).json({ error: 'Поездка не найдена или уже отменена' });
        return;
    }
    res.json({ ok: true });
});
exports.ridesRouter.get('/:id', (req, res) => {
    const ride = (0, rideService_1.getRideWithDriver)(Number(req.params.id));
    if (!ride) {
        res.status(404).json({ error: 'Поездка не найдена' });
        return;
    }
    res.json({ ride });
});
