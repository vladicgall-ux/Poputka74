"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BookingError = void 0;
exports.createBooking = createBooking;
exports.cancelBooking = cancelBooking;
exports.countCancelledBookingsByPassenger = countCancelledBookingsByPassenger;
exports.confirmBooking = confirmBooking;
exports.declineBooking = declineBooking;
exports.getBookingWithPeople = getBookingWithPeople;
exports.listAllBookings = listAllBookings;
exports.listBookingsByPassenger = listBookingsByPassenger;
exports.listBookingsForRide = listBookingsForRide;
exports.listConfirmedPassengerIds = listConfirmedPassengerIds;
exports.listBookingsDueForRatingReminder = listBookingsDueForRatingReminder;
exports.markRatingReminderSent = markRatingReminderSent;
exports.getRidePassengers = getRidePassengers;
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
    if (new Date(ride.departure_at).getTime() < Date.now()) {
        throw new BookingError('Поездка уже состоялась');
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
    db_1.db.prepare(`UPDATE bookings SET status = 'cancelled', cancelled_at = datetime('now') WHERE id = ?`).run(bookingId);
    (0, rideService_1.incrementSeats)(booking.ride_id, booking.seats_booked);
    return { ...booking, status: 'cancelled' };
}
/** Сколько броней пассажир отменил сам — сигнал для модерации в админке. */
function countCancelledBookingsByPassenger(passengerId) {
    const row = db_1.db
        .prepare(`SELECT COUNT(*) AS n FROM bookings WHERE passenger_id = ? AND cancelled_at IS NOT NULL`)
        .get(passengerId);
    return row.n;
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
        .prepare(`SELECT b.*, r.from_city, r.to_city, r.departure_at, r.price_per_seat, r.meeting_point, r.dropoff_point, r.driver_id,
              p.first_name AS passenger_first_name, p.username AS passenger_username, p.full_name AS passenger_full_name, p.phone AS passenger_phone, p.platform AS passenger_platform,
              drv.first_name AS driver_first_name, drv.username AS driver_username, drv.full_name AS driver_full_name, drv.phone AS driver_phone, drv.platform AS driver_platform
       FROM bookings b
       JOIN rides r ON r.id = b.ride_id
       JOIN users p ON p.telegram_id = b.passenger_id
       JOIN users drv ON drv.telegram_id = r.driver_id
       WHERE b.id = ?`)
        .get(bookingId);
}
function listAllBookings() {
    return db_1.db
        .prepare(`SELECT b.*, r.from_city, r.to_city, r.departure_at, r.price_per_seat, r.meeting_point, r.dropoff_point, r.driver_id,
              p.first_name AS passenger_first_name, p.username AS passenger_username, p.full_name AS passenger_full_name, p.phone AS passenger_phone,
              drv.first_name AS driver_first_name, drv.username AS driver_username, drv.full_name AS driver_full_name
       FROM bookings b
       JOIN rides r ON r.id = b.ride_id
       JOIN users p ON p.telegram_id = b.passenger_id
       JOIN users drv ON drv.telegram_id = r.driver_id
       ORDER BY b.created_at DESC`)
        .all();
}
function listBookingsByPassenger(passengerId, range) {
    const clauses = ['b.passenger_id = @passengerId'];
    const params = { passengerId };
    if (range) {
        clauses.push("date(r.departure_at, '+5 hours') BETWEEN @from AND @to");
        params.from = range.from;
        params.to = range.to;
    }
    return db_1.db
        .prepare(`SELECT b.*, r.from_city, r.to_city, r.departure_at, r.price_per_seat, r.meeting_point, r.dropoff_point, r.driver_id,
              EXISTS(SELECT 1 FROM ratings rt WHERE rt.ride_id = b.ride_id AND rt.passenger_id = b.passenger_id) AS rated
       FROM bookings b JOIN rides r ON r.id = b.ride_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY r.departure_at ASC`)
        .all(params);
}
function listBookingsForRide(rideId) {
    return db_1.db
        .prepare(`SELECT * FROM bookings WHERE ride_id = ? AND status IN ('pending', 'confirmed')`)
        .all(rideId);
}
/** Пассажиры с подтверждённой бронью на поездку — для напоминания о скором отправлении. */
function listConfirmedPassengerIds(rideId) {
    return db_1.db
        .prepare(`SELECT passenger_id FROM bookings WHERE ride_id = ? AND status = 'confirmed'`)
        .all(rideId).map((r) => r.passenger_id);
}
/**
 * Подтверждённые брони на поездки, которые состоялись более часа назад,
 * ещё не оценены пассажиром и по которым напоминание ещё не отправлялось.
 */
function listBookingsDueForRatingReminder() {
    return db_1.db
        .prepare(`SELECT b.id, b.passenger_id, r.id AS ride_id, r.from_city, r.to_city, drv.first_name AS driver_first_name, drv.full_name AS driver_full_name
       FROM bookings b
       JOIN rides r ON r.id = b.ride_id
       JOIN users drv ON drv.telegram_id = r.driver_id
       WHERE b.status = 'confirmed'
         AND b.reminder_sent = 0
         AND datetime(r.departure_at) <= datetime('now', '-1 hour')
         AND NOT EXISTS (SELECT 1 FROM ratings rt WHERE rt.ride_id = b.ride_id AND rt.passenger_id = b.passenger_id)`)
        .all();
}
function markRatingReminderSent(bookingId) {
    db_1.db.prepare(`UPDATE bookings SET reminder_sent = 1 WHERE id = ?`).run(bookingId);
}
/** Список пассажиров поездки + заработок — доступно только водителю этой поездки. */
function getRidePassengers(rideId, driverId) {
    const ride = (0, rideService_1.getRide)(rideId);
    if (!ride || ride.driver_id !== driverId) {
        throw new BookingError('Это не ваша поездка');
    }
    const passengers = db_1.db
        .prepare(`SELECT b.id, b.passenger_id, b.seats_booked, b.status, u.first_name, u.username, u.full_name, u.phone,
              ROUND(pr.avg_rating, 1) AS avg_rating, COALESCE(pr.rating_count, 0) AS rating_count,
              EXISTS(SELECT 1 FROM passenger_ratings x WHERE x.ride_id = b.ride_id AND x.passenger_id = b.passenger_id) AS rated_by_driver
       FROM bookings b
       JOIN users u ON u.telegram_id = b.passenger_id
       LEFT JOIN (
         SELECT passenger_id, AVG(rating) AS avg_rating, COUNT(*) AS rating_count
         FROM passenger_ratings GROUP BY passenger_id
       ) pr ON pr.passenger_id = b.passenger_id
       WHERE b.ride_id = ? AND b.status IN ('pending', 'confirmed')
       ORDER BY b.created_at ASC`)
        .all(rideId);
    const earnings = passengers
        .filter((p) => p.status === 'confirmed')
        .reduce((sum, p) => sum + p.seats_booked * ride.price_per_seat, 0);
    return { passengers, earnings };
}
