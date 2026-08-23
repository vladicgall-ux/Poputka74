import { db } from '../db/db';
import { decrementSeats, incrementSeats, getRide } from './rideService';

export interface BookingRecord {
  id: number;
  ride_id: number;
  passenger_id: number;
  seats_booked: number;
  status: 'pending' | 'confirmed' | 'cancelled';
  created_at: string;
}

export interface BookingWithRide extends BookingRecord {
  from_city: string;
  to_city: string;
  departure_at: string;
  price_per_seat: number;
  driver_id: number;
}

export class BookingError extends Error {}

/**
 * Атомарно резервирует места (уменьшает seats_available) и создаёт запись
 * бронирования со статусом 'pending' — место удерживается сразу, чтобы
 * его не забрал кто-то другой, но окончательно бронь становится только
 * после того, как водитель подтвердит её кнопкой в чате с ботом.
 */
export function createBooking(input: {
  rideId: number;
  passengerId: number;
  seats: number;
}): BookingRecord {
  const ride = getRide(input.rideId);
  if (!ride || ride.status !== 'active') {
    throw new BookingError('Поездка недоступна');
  }
  if (ride.driver_id === input.passengerId) {
    throw new BookingError('Нельзя забронировать место в собственной поездке');
  }

  const already = db
    .prepare(
      `SELECT COALESCE(SUM(seats_booked), 0) AS total FROM bookings
       WHERE ride_id = ? AND passenger_id = ? AND status IN ('pending', 'confirmed')`
    )
    .get(input.rideId, input.passengerId) as { total: number };
  if (already.total > 0) {
    throw new BookingError('Вы уже забронировали место в этой поездке');
  }

  const ok = decrementSeats(input.rideId, input.seats);
  if (!ok) {
    throw new BookingError('Недостаточно свободных мест');
  }

  const info = db
    .prepare(`INSERT INTO bookings (ride_id, passenger_id, seats_booked) VALUES (?, ?, ?)`)
    .run(input.rideId, input.passengerId, input.seats);
  return db.prepare('SELECT * FROM bookings WHERE id = ?').get(info.lastInsertRowid) as BookingRecord;
}

export function cancelBooking(bookingId: number, passengerId: number): BookingRecord {
  const booking = db
    .prepare('SELECT * FROM bookings WHERE id = ? AND passenger_id = ?')
    .get(bookingId, passengerId) as BookingRecord | undefined;
  if (!booking || (booking.status !== 'confirmed' && booking.status !== 'pending')) {
    throw new BookingError('Бронирование не найдено');
  }
  db.prepare(`UPDATE bookings SET status = 'cancelled' WHERE id = ?`).run(bookingId);
  incrementSeats(booking.ride_id, booking.seats_booked);
  return { ...booking, status: 'cancelled' };
}

/** Водитель подтверждает бронь — только для своих поездок и только из статуса 'pending'. */
export function confirmBooking(bookingId: number, driverId: number): BookingRecord {
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId) as
    | BookingRecord
    | undefined;
  if (!booking || booking.status !== 'pending') {
    throw new BookingError('Бронирование уже обработано');
  }
  const ride = getRide(booking.ride_id);
  if (!ride || ride.driver_id !== driverId) {
    throw new BookingError('Это не ваша поездка');
  }
  db.prepare(`UPDATE bookings SET status = 'confirmed' WHERE id = ?`).run(bookingId);
  return { ...booking, status: 'confirmed' };
}

/** Водитель отклоняет бронь — место возвращается в число свободных. */
export function declineBooking(bookingId: number, driverId: number): BookingRecord {
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId) as
    | BookingRecord
    | undefined;
  if (!booking || booking.status !== 'pending') {
    throw new BookingError('Бронирование уже обработано');
  }
  const ride = getRide(booking.ride_id);
  if (!ride || ride.driver_id !== driverId) {
    throw new BookingError('Это не ваша поездка');
  }
  db.prepare(`UPDATE bookings SET status = 'cancelled' WHERE id = ?`).run(bookingId);
  incrementSeats(booking.ride_id, booking.seats_booked);
  return { ...booking, status: 'cancelled' };
}

export interface BookingWithPeople extends BookingWithRide {
  passenger_first_name: string;
  passenger_username: string | null;
  passenger_phone: string | null;
  driver_first_name: string;
  driver_username: string | null;
}

/** Полный контекст брони (поездка + пассажир + водитель) для сообщений бота. */
export function getBookingWithPeople(bookingId: number): BookingWithPeople | undefined {
  return db
    .prepare(
      `SELECT b.*, r.from_city, r.to_city, r.departure_at, r.price_per_seat, r.driver_id,
              p.first_name AS passenger_first_name, p.username AS passenger_username, p.phone AS passenger_phone,
              drv.first_name AS driver_first_name, drv.username AS driver_username
       FROM bookings b
       JOIN rides r ON r.id = b.ride_id
       JOIN users p ON p.telegram_id = b.passenger_id
       JOIN users drv ON drv.telegram_id = r.driver_id
       WHERE b.id = ?`
    )
    .get(bookingId) as BookingWithPeople | undefined;
}

export function listAllBookings(): BookingWithPeople[] {
  return db
    .prepare(
      `SELECT b.*, r.from_city, r.to_city, r.departure_at, r.price_per_seat, r.driver_id,
              p.first_name AS passenger_first_name, p.username AS passenger_username, p.phone AS passenger_phone,
              drv.first_name AS driver_first_name, drv.username AS driver_username
       FROM bookings b
       JOIN rides r ON r.id = b.ride_id
       JOIN users p ON p.telegram_id = b.passenger_id
       JOIN users drv ON drv.telegram_id = r.driver_id
       ORDER BY b.created_at DESC`
    )
    .all() as BookingWithPeople[];
}

export function listBookingsByPassenger(passengerId: number): BookingWithRide[] {
  return db
    .prepare(
      `SELECT b.*, r.from_city, r.to_city, r.departure_at, r.price_per_seat, r.driver_id
       FROM bookings b JOIN rides r ON r.id = b.ride_id
       WHERE b.passenger_id = ?
       ORDER BY r.departure_at DESC`
    )
    .all(passengerId) as BookingWithRide[];
}

export function listBookingsForRide(rideId: number): BookingRecord[] {
  return db
    .prepare(`SELECT * FROM bookings WHERE ride_id = ? AND status IN ('pending', 'confirmed')`)
    .all(rideId) as BookingRecord[];
}
