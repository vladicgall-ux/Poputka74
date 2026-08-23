"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BookingError = void 0;
exports.createBooking = createBooking;
exports.cancelBooking = cancelBooking;
exports.listBookingsByPassenger = listBookingsByPassenger;
exports.listBookingsForRide = listBookingsForRide;
const db_1 = require("../db/db");
const rideService_1 = require("./rideService");
class BookingError extends Error {
}
exports.BookingError = BookingError;
/** Атомарно бронирует места: уменьшает seats_available и создаёт запись. */
function createBooking(input) {
    const ride = (0, rideService_1.getRide)(input.rideId);
    if (!ride || ride.status !== 'active') {
        throw new BookingError('Поездка недоступна');
    }
    if (ride.driver_id === input.passengerId) {
        throw new BookingError('Нельзя забронировать место в собственной поездке');
    }
    const already = db_1.db
        .prepare(`SELECT COALESCE(SUM(seats_booked), 0) AS total FROM bookings
       WHERE ride_id = ? AND passenger_id = ? AND status = 'confirmed'`)
        .get(input.rideId, input.passengerId);
    if (already.total > 0) {
        throw new BookingError('Вы уже забронировали место в этой поездке');
    }
    const ok = (0, rideService_1.decrementSeats)(input.rideId, input.seats);
    if (!ok) {
        throw new BookingError('Недостаточно свободных мест');
    }
    const info = db_1.db
        .prepare(`INSERT INTO bookings (ride_id, passenger_id, seats_booked) VALUES (?, ?, ?)`)
        .run(input.rideId, input.passengerId, input.seats);
    return db_1.db.prepare('SELECT * FROM bookings WHERE id = ?').get(info.lastInsertRowid);
}
function cancelBooking(bookingId, passengerId) {
    const booking = db_1.db
        .prepare('SELECT * FROM bookings WHERE id = ? AND passenger_id = ?')
        .get(bookingId, passengerId);
    if (!booking || booking.status !== 'confirmed') {
        throw new BookingError('Бронирование не найдено');
    }
    db_1.db.prepare(`UPDATE bookings SET status = 'cancelled' WHERE id = ?`).run(bookingId);
    (0, rideService_1.incrementSeats)(booking.ride_id, booking.seats_booked);
    return { ...booking, status: 'cancelled' };
}
function listBookingsByPassenger(passengerId) {
    return db_1.db
        .prepare(`SELECT b.*, r.from_city, r.to_city, r.departure_at, r.price_per_seat, r.driver_id
       FROM bookings b JOIN rides r ON r.id = b.ride_id
       WHERE b.passenger_id = ?
       ORDER BY r.departure_at DESC`)
        .all(passengerId);
}
function listBookingsForRide(rideId) {
    return db_1.db
        .prepare(`SELECT * FROM bookings WHERE ride_id = ? AND status = 'confirmed'`)
        .all(rideId);
}
