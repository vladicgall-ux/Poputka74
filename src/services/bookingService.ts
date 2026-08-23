import { db } from '../db/db';
import { decrementSeats, incrementSeats, getRide } from './rideService';

export interface BookingRecord {
  id: number;
  ride_id: number;
  passenger_id: number;
  seats_booked: number;
  status: 'confirmed' | 'cancelled';
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

/** Атомарно бронирует места: уменьшает seats_available и создаёт запись. */
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
       WHERE ride_id = ? AND passenger_id = ? AND status = 'confirmed'`
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
    .prepare(
      `INSERT INTO bookings (ride_id, passenger_id, seats_booked) VALUES (?, ?, ?)`
    )
    .run(input.rideId, input.passengerId, input.seats);
  return db.prepare('SELECT * FROM bookings WHERE id = ?').get(info.lastInsertRowid) as BookingRecord;
}

export function cancelBooking(bookingId: number, passengerId: number): BookingRecord {
  const booking = db
    .prepare('SELECT * FROM bookings WHERE id = ? AND passenger_id = ?')
    .get(bookingId, passengerId) as BookingRecord | undefined;
  if (!booking || booking.status !== 'confirmed') {
    throw new BookingError('Бронирование не найдено');
  }
  db.prepare(`UPDATE bookings SET status = 'cancelled' WHERE id = ?`).run(bookingId);
  incrementSeats(booking.ride_id, booking.seats_booked);
  return { ...booking, status: 'cancelled' };
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

export interface BookingWithPeople extends BookingWithRide {
  passenger_first_name: string;
  passenger_username: string | null;
  passenger_phone: string | null;
  driver_first_name: string;
}

export function listAllBookings(): BookingWithPeople[] {
  return db
    .prepare(
      `SELECT b.*, r.from_city, r.to_city, r.departure_at, r.price_per_seat, r.driver_id,
              p.first_name AS passenger_first_name, p.username AS passenger_username, p.phone AS passenger_phone,
              drv.first_name AS driver_first_name
       FROM bookings b
       JOIN rides r ON r.id = b.ride_id
       JOIN users p ON p.telegram_id = b.passenger_id
       JOIN users drv ON drv.telegram_id = r.driver_id
       ORDER BY b.created_at DESC`
    )
    .all() as BookingWithPeople[];
}

export function listBookingsForRide(rideId: number): BookingRecord[] {
  return db
    .prepare(`SELECT * FROM bookings WHERE ride_id = ? AND status = 'confirmed'`)
    .all(rideId) as BookingRecord[];
}
