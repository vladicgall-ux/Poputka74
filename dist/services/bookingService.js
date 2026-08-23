"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BookingError = void 0;
exports.createBooking = createBooking;
exports.cancelBooking = cancelBooking;
exports.confirmBooking = confirmBooking;
exports.declineBooking = declineBooking;
exports.getBookingWithPeople = getBookingWithPeople;
exports.listAllBookings = listAllBookings;
exports.listBookingsByPassenger = listBookingsByPassenger;
exports.listBookingsForRide = listBookingsForRide;
const db_1 = require("../db/db");
const rideService_1 = require("./rideService");
class BookingError extends Error {
}
exports.BookingError = BookingError;
/**
 * Атомарно резервирует места (уменьшает seats_available) и создаёт запись
 * бронирования со статусом 'pending' — место удерживается сразу, чтобы
 * его не забрал кто-то другой, но окончательно бронь становится только
 * после того, как водитель подтвердит её кнопкой в чате с ботом.
 */
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
       WHERE ride_id = ? AND passenger_id = ? AND status IN ('pending', 'confirmed')`)
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
    if (!booking || (booking.status !== 'confirmed' && booking.status !== 'pending')) {
        throw new BookingError('Бронирование не найдено');
    }
    db_1.db.prepare(`UPDATE bookings SET status = 'cancelled' WHERE id = ?`).run(bookingId);
    (0, rideService_1.incrementSeats)(booking.ride_id, booking.seats_booked);
    return { ...booking, status: 'cancelled' };
}
/** Водитель подтверждает бронь — только для своих поездок и только из статуса 'pending'. */
function confirmBooking(bookingId, driverId) {
    const booking = db_1.db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId);
    if (!booking || booking.status !== 'pending') {
        throw new BookingError('Бронирование уже обработано');
    }
    const ride = (0, rideService_1.getRide)(booking.ride_id);
    if (!ride || ride.driver_id !== driverId) {
        throw new BookingError('Это не ваша поездка');
    }
    db_1.db.prepare(`UPDATE bookings SET status = 'confirmed' WHERE id = ?`).run(bookingId);
    return { ...booking, status: 'confirmed' };
}
/** Водитель отклоняет бронь — место возвращается в число свободных. */
function declineBooking(bookingId, driverId) {
    const booking = db_1.db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId);
    if (!booking || booking.status !== 'pending') {
        throw new BookingError('Бронирование уже обработано');
    }
    const ride = (0, rideService_1.getRide)(booking.ride_id);
    if (!ride || ride.driver_id !== driverId) {
        throw new BookingError('Это не ваша поездка');
    }
    db_1.db.prepare(`UPDATE bookings SET status = 'cancelled' WHERE id = ?`).run(bookingId);
    (0, rideService_1.incrementSeats)(booking.ride_id, booking.seats_booked);
    return { ...booking, status: 'cancelled' };
}
/** Полный контекст брони (поездка + пассажир + водитель) для сообщений бота. */
function getBookingWithPeople(bookingId) {
    return db_1.db
        .prepare(`SELECT b.*, r.from_city, r.to_city, r.departure_at, r.price_per_seat, r.driver_id,
              p.first_name AS passenger_first_name, p.username AS passenger_username, p.phone AS passenger_phone,
              drv.first_name AS driver_first_name, drv.username AS driver_username
       FROM bookings b
       JOIN rides r ON r.id = b.ride_id
       JOIN users p ON p.telegram_id = b.passenger_id
       JOIN users drv ON drv.telegram_id = r.driver_id
       WHERE b.id = ?`)
        .get(bookingId);
}
function listAllBookings() {
    return db_1.db
        .prepare(`SELECT b.*, r.from_city, r.to_city, r.departure_at, r.price_per_seat, r.driver_id,
              p.first_name AS passenger_first_name, p.username AS passenger_username, p.phone AS passenger_phone,
              drv.first_name AS driver_first_name, drv.username AS driver_username
       FROM bookings b
       JOIN rides r ON r.id = b.ride_id
       JOIN users p ON p.telegram_id = b.passenger_id
       JOIN users drv ON drv.telegram_id = r.driver_id
       ORDER BY b.created_at DESC`)
        .all();
}
function listBookingsByPassenger(passengerId) {
    return db_1.db
        .prepare(`SELECT b.*, r.from_city, r.to_city, r.departure_at, r.price_per_seat, r.driver_id,
              EXISTS(SELECT 1 FROM ratings rt WHERE rt.ride_id = b.ride_id AND rt.passenger_id = b.passenger_id) AS rated
       FROM bookings b JOIN rides r ON r.id = b.ride_id
       WHERE b.passenger_id = ?
       ORDER BY r.departure_at DESC`)
        .all(passengerId);
}
function listBookingsForRide(rideId) {
    return db_1.db
        .prepare(`SELECT * FROM bookings WHERE ride_id = ? AND status IN ('pending', 'confirmed')`)
        .all(rideId);
}
