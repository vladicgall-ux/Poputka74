"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RatingError = void 0;
exports.createRating = createRating;
exports.getDriverRatingSummary = getDriverRatingSummary;
exports.createPassengerRating = createPassengerRating;
exports.getPassengerRatingSummary = getPassengerRatingSummary;
const db_1 = require("../db/db");
const rideService_1 = require("./rideService");
class RatingError extends Error {
}
exports.RatingError = RatingError;
/**
 * Пассажир оценивает водителя после того, как поездка фактически состоялась
 * (departure_at в прошлом) и его бронь была подтверждена водителем.
 * Одна оценка на пару (поездка, пассажир) — обеспечено UNIQUE-ограничением.
 */
function createRating(input) {
    const ride = (0, rideService_1.getRide)(input.rideId);
    if (!ride) {
        throw new RatingError('Поездка не найдена');
    }
    if (new Date(ride.departure_at).getTime() > Date.now()) {
        throw new RatingError('Оценить поездку можно только после того, как она состоится');
    }
    const booking = db_1.db
        .prepare(`SELECT 1 FROM bookings WHERE ride_id = ? AND passenger_id = ? AND status = 'confirmed'`)
        .get(input.rideId, input.passengerId);
    if (!booking) {
        throw new RatingError('У вас нет подтверждённой брони на эту поездку');
    }
    try {
        const info = db_1.db
            .prepare(`INSERT INTO ratings (ride_id, driver_id, passenger_id, rating, comment)
         VALUES (?, ?, ?, ?, ?)`)
            .run(input.rideId, ride.driver_id, input.passengerId, input.rating, input.comment ?? null);
        return db_1.db.prepare('SELECT * FROM ratings WHERE id = ?').get(info.lastInsertRowid);
    }
    catch (err) {
        if (err instanceof Error && err.message.includes('UNIQUE')) {
            throw new RatingError('Вы уже оценили эту поездку');
        }
        throw err;
    }
}
function getDriverRatingSummary(driverId) {
    const row = db_1.db
        .prepare(`SELECT AVG(rating) AS avg, COUNT(*) AS count FROM ratings WHERE driver_id = ?`)
        .get(driverId);
    return { avg: row.avg !== null ? Math.round(row.avg * 10) / 10 : null, count: row.count };
}
/**
 * Водитель оценивает пассажира после того, как поездка состоялась и бронь
 * этого пассажира была подтверждена — зеркало createRating() в обратную
 * сторону, помогает будущим водителям решить, подтверждать ли бронь.
 */
function createPassengerRating(input) {
    const ride = (0, rideService_1.getRide)(input.rideId);
    if (!ride) {
        throw new RatingError('Поездка не найдена');
    }
    if (ride.driver_id !== input.driverId) {
        throw new RatingError('Это не ваша поездка');
    }
    if (new Date(ride.departure_at).getTime() > Date.now()) {
        throw new RatingError('Оценить пассажира можно только после того, как поездка состоится');
    }
    const booking = db_1.db
        .prepare(`SELECT 1 FROM bookings WHERE ride_id = ? AND passenger_id = ? AND status = 'confirmed'`)
        .get(input.rideId, input.passengerId);
    if (!booking) {
        throw new RatingError('У этого пассажира нет подтверждённой брони на эту поездку');
    }
    try {
        const info = db_1.db
            .prepare(`INSERT INTO passenger_ratings (ride_id, driver_id, passenger_id, rating, comment)
         VALUES (?, ?, ?, ?, ?)`)
            .run(input.rideId, input.driverId, input.passengerId, input.rating, input.comment ?? null);
        return db_1.db.prepare('SELECT * FROM passenger_ratings WHERE id = ?').get(info.lastInsertRowid);
    }
    catch (err) {
        if (err instanceof Error && err.message.includes('UNIQUE')) {
            throw new RatingError('Вы уже оценили этого пассажира за эту поездку');
        }
        throw err;
    }
}
function getPassengerRatingSummary(passengerId) {
    const row = db_1.db
        .prepare(`SELECT AVG(rating) AS avg, COUNT(*) AS count FROM passenger_ratings WHERE passenger_id = ?`)
        .get(passengerId);
    return { avg: row.avg !== null ? Math.round(row.avg * 10) / 10 : null, count: row.count };
}
