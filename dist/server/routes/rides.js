"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ridesRouter = void 0;
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const rateLimit_1 = require("../middleware/rateLimit");
const userService_1 = require("../../services/userService");
const rideService_1 = require("../../services/rideService");
const rideTemplateService_1 = require("../../services/rideTemplateService");
const bookingService_1 = require("../../services/bookingService");
const statsService_1 = require("../../services/statsService");
const config_1 = require("../../config");
exports.ridesRouter = (0, express_1.Router)();
exports.ridesRouter.use(auth_1.requireTelegramAuth, auth_1.requireActiveUser);
function isCity(value) {
    return typeof value === 'string' && config_1.config.cities.includes(value);
}
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Читает и валидирует ?from=&to= (YYYY-MM-DD) — используется для фильтров по дате. */
function parseRange(req) {
    const from = req.query.from;
    const to = req.query.to;
    if (typeof from === 'string' && typeof to === 'string' && DATE_RE.test(from) && DATE_RE.test(to)) {
        return { from, to };
    }
    return undefined;
}
/** Поиск активных поездок, опционально по направлению, дате, местам и рейтингу водителя. */
exports.ridesRouter.get('/', (req, res) => {
    const fromCity = isCity(req.query.from) ? req.query.from : undefined;
    const toCity = isCity(req.query.to) ? req.query.to : undefined;
    const date = typeof req.query.date === 'string' && DATE_RE.test(req.query.date) ? req.query.date : undefined;
    const minSeats = Number(req.query.minSeats);
    const minRating = Number(req.query.minRating);
    const sort = req.query.sort === 'price' ? 'price' : 'time';
    const rides = (0, rideService_1.searchRides)({
        fromCity,
        toCity,
        date,
        onlyAvailable: req.query.onlyAvailable === '1',
        minSeats: Number.isInteger(minSeats) && minSeats > 0 ? minSeats : undefined,
        minRating: Number.isFinite(minRating) && minRating > 0 ? minRating : undefined,
        sort,
    });
    res.json({ rides });
});
/** Поездки текущего водителя, опционально в диапазоне дат. */
exports.ridesRouter.get('/mine', (req, res) => {
    const { user } = req;
    res.json({ rides: (0, rideService_1.listRidesByDriver)(user.telegram_id, parseRange(req)) });
});
/** Статистика водителя (число поездок, пассажиров, заработок) за диапазон дат. */
exports.ridesRouter.get('/mine/stats', (req, res) => {
    const { user } = req;
    const range = parseRange(req);
    if (!range) {
        res.status(400).json({ error: 'Укажите диапазон дат (from, to)' });
        return;
    }
    res.json({ stats: (0, statsService_1.getDriverStats)(user.telegram_id, range.from, range.to) });
});
/** Публикация новой поездки. Требует зарегистрированного и верифицированного водителя. */
exports.ridesRouter.post('/', (0, rateLimit_1.writeLimiter)(15, 10 * 60000), (req, res) => {
    const { user } = req;
    const driverProfile = (0, userService_1.getDriverProfile)(user.telegram_id);
    if (!driverProfile) {
        res.status(403).json({ error: 'Сначала зарегистрируйтесь как водитель' });
        return;
    }
    const { fromCity, toCity, departureAt, pricePerSeat, seatsTotal, comment, meetingPoint, dropoffPoint } = req.body ?? {};
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
        meetingPoint: typeof meetingPoint === 'string' ? meetingPoint.trim().slice(0, 200) : undefined,
        dropoffPoint: typeof dropoffPoint === 'string' ? dropoffPoint.trim().slice(0, 200) : undefined,
    });
    res.status(201).json({ ride });
});
/** Шаблоны регулярных поездок текущего водителя. */
exports.ridesRouter.get('/templates/mine', (req, res) => {
    const { user } = req;
    res.json({ templates: (0, rideTemplateService_1.listTemplatesByDriver)(user.telegram_id) });
});
/** Создание шаблона регулярной поездки — реальные rides генерируются периодической задачей. */
exports.ridesRouter.post('/templates', (0, rateLimit_1.writeLimiter)(10, 10 * 60000), (req, res) => {
    const { user } = req;
    const driverProfile = (0, userService_1.getDriverProfile)(user.telegram_id);
    if (!driverProfile) {
        res.status(403).json({ error: 'Сначала зарегистрируйтесь как водитель' });
        return;
    }
    const { fromCity, toCity, departureTime, weekdays, pricePerSeat, seatsTotal, comment, meetingPoint, dropoffPoint } = req.body ?? {};
    if (!isCity(fromCity) || !isCity(toCity) || fromCity === toCity) {
        res.status(400).json({ error: 'Некорректное направление поездки' });
        return;
    }
    if (typeof departureTime !== 'string' || !/^\d{2}:\d{2}$/.test(departureTime)) {
        res.status(400).json({ error: 'Укажите время отправления в формате ЧЧ:ММ' });
        return;
    }
    const weekdaysList = Array.isArray(weekdays) ? weekdays.map(Number).filter((n) => n >= 0 && n <= 6) : [];
    if (!weekdaysList.length) {
        res.status(400).json({ error: 'Выберите хотя бы один день недели' });
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
    const template = (0, rideTemplateService_1.createRideTemplate)({
        driverId: user.telegram_id,
        fromCity,
        toCity,
        departureTime,
        weekdays: weekdaysList,
        pricePerSeat: price,
        seatsTotal: seats,
        comment: typeof comment === 'string' ? comment.trim().slice(0, 300) : undefined,
        meetingPoint: typeof meetingPoint === 'string' ? meetingPoint.trim().slice(0, 200) : undefined,
        dropoffPoint: typeof dropoffPoint === 'string' ? dropoffPoint.trim().slice(0, 200) : undefined,
    });
    res.status(201).json({ template });
});
/** Остановка регулярной поездки — уже созданные rides не трогает, только будущую генерацию. */
exports.ridesRouter.post('/templates/:id/deactivate', (req, res) => {
    const { user } = req;
    const ok = (0, rideTemplateService_1.deactivateTemplate)(Number(req.params.id), user.telegram_id);
    if (!ok) {
        res.status(404).json({ error: 'Шаблон не найден' });
        return;
    }
    res.json({ ok: true });
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
/** Пассажиры поездки + заработок — видно только водителю этой поездки. */
exports.ridesRouter.get('/:id/passengers', (req, res) => {
    const { user } = req;
    try {
        const result = (0, bookingService_1.getRidePassengers)(Number(req.params.id), user.telegram_id);
        res.json(result);
    }
    catch (err) {
        if (err instanceof bookingService_1.BookingError) {
            res.status(403).json({ error: err.message });
            return;
        }
        throw err;
    }
});
exports.ridesRouter.get('/:id', (req, res) => {
    const ride = (0, rideService_1.getRideWithDriver)(Number(req.params.id));
    if (!ride) {
        res.status(404).json({ error: 'Поездка не найдена' });
        return;
    }
    res.json({ ride });
});
