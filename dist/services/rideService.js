"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRide = createRide;
exports.getRide = getRide;
exports.searchRides = searchRides;
exports.getRideWithDriver = getRideWithDriver;
exports.listAllRides = listAllRides;
exports.listRidesByDriver = listRidesByDriver;
exports.cancelRide = cancelRide;
exports.decrementSeats = decrementSeats;
exports.incrementSeats = incrementSeats;
const db_1 = require("../db/db");
function createRide(input) {
    const info = db_1.db
        .prepare(`INSERT INTO rides (driver_id, from_city, to_city, departure_at, price_per_seat, seats_total, seats_available, comment)
       VALUES (@driverId, @fromCity, @toCity, @departureAt, @pricePerSeat, @seatsTotal, @seatsTotal, @comment)`)
        .run({
        driverId: input.driverId,
        fromCity: input.fromCity,
        toCity: input.toCity,
        departureAt: input.departureAt,
        pricePerSeat: input.pricePerSeat,
        seatsTotal: input.seatsTotal,
        comment: input.comment ?? null,
    });
    return getRide(Number(info.lastInsertRowid));
}
function getRide(id) {
    return db_1.db.prepare('SELECT * FROM rides WHERE id = ?').get(id);
}
const RIDE_WITH_DRIVER_SELECT = `
  SELECT r.*,
         u.first_name AS driver_first_name,
         u.username   AS driver_username,
         d.car_model, d.car_color, d.car_plate, d.photo_path,
         ROUND(rt.avg_rating, 1) AS avg_rating, COALESCE(rt.rating_count, 0) AS rating_count
  FROM rides r
  JOIN users u ON u.telegram_id = r.driver_id
  JOIN driver_profiles d ON d.telegram_id = r.driver_id
  LEFT JOIN (
    SELECT driver_id, AVG(rating) AS avg_rating, COUNT(*) AS rating_count
    FROM ratings GROUP BY driver_id
  ) rt ON rt.driver_id = r.driver_id
`;
function searchRides(filter) {
    const clauses = [`r.status = 'active'`, `r.departure_at >= datetime('now')`, `u.banned = 0`];
    const params = {};
    if (filter.fromCity) {
        clauses.push('r.from_city = @fromCity');
        params.fromCity = filter.fromCity;
    }
    if (filter.toCity) {
        clauses.push('r.to_city = @toCity');
        params.toCity = filter.toCity;
    }
    if (filter.onlyAvailable) {
        clauses.push('r.seats_available > 0');
    }
    if (filter.date) {
        clauses.push('date(r.departure_at) = @date');
        params.date = filter.date;
    }
    const sql = `${RIDE_WITH_DRIVER_SELECT} WHERE ${clauses.join(' AND ')} ORDER BY r.departure_at ASC`;
    return db_1.db.prepare(sql).all(params);
}
function getRideWithDriver(id) {
    return db_1.db.prepare(`${RIDE_WITH_DRIVER_SELECT} WHERE r.id = @id`).get({ id });
}
function listAllRides() {
    return db_1.db
        .prepare(`${RIDE_WITH_DRIVER_SELECT} ORDER BY r.departure_at ASC`)
        .all();
}
function listRidesByDriver(driverId, range) {
    const clauses = ['driver_id = @driverId'];
    const params = { driverId };
    if (range) {
        clauses.push('date(departure_at) BETWEEN @from AND @to');
        params.from = range.from;
        params.to = range.to;
    }
    return db_1.db
        .prepare(`SELECT * FROM rides WHERE ${clauses.join(' AND ')} ORDER BY departure_at ASC`)
        .all(params);
}
function cancelRide(id, driverId) {
    const info = db_1.db
        .prepare(`UPDATE rides SET status = 'cancelled' WHERE id = ? AND driver_id = ? AND status = 'active'`)
        .run(id, driverId);
    return info.changes > 0;
}
function decrementSeats(rideId, seats) {
    const info = db_1.db
        .prepare(`UPDATE rides SET seats_available = seats_available - ?
       WHERE id = ? AND seats_available >= ? AND status = 'active'`)
        .run(seats, rideId, seats);
    return info.changes > 0;
}
function incrementSeats(rideId, seats) {
    db_1.db.prepare(`UPDATE rides SET seats_available = MIN(seats_total, seats_available + ?) WHERE id = ?`).run(seats, rideId);
}
