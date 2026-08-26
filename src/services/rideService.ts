import { db } from '../db/db';
import type { City } from '../config';

export interface RideRecord {
  id: number;
  driver_id: number;
  from_city: City;
  to_city: City;
  departure_at: string;
  price_per_seat: number;
  seats_total: number;
  seats_available: number;
  comment: string | null;
  meeting_point: string | null;
  status: 'active' | 'cancelled' | 'completed';
  departure_reminder_sent: number;
  template_id: number | null;
  cancelled_at: string | null;
  created_at: string;
}

export interface RideWithDriver extends RideRecord {
  driver_first_name: string;
  driver_username: string | null;
  driver_full_name: string | null;
  car_model: string;
  car_color: string | null;
  car_plate: string;
  photo_path: string | null;
  avg_rating: number | null;
  rating_count: number;
}

export function createRide(input: {
  driverId: number;
  fromCity: City;
  toCity: City;
  departureAt: string;
  pricePerSeat: number;
  seatsTotal: number;
  comment?: string;
  meetingPoint?: string;
  templateId?: number;
}): RideRecord {
  const info = db
    .prepare(
      `INSERT INTO rides (driver_id, from_city, to_city, departure_at, price_per_seat, seats_total, seats_available, comment, meeting_point, template_id)
       VALUES (@driverId, @fromCity, @toCity, @departureAt, @pricePerSeat, @seatsTotal, @seatsTotal, @comment, @meetingPoint, @templateId)`
    )
    .run({
      driverId: input.driverId,
      fromCity: input.fromCity,
      toCity: input.toCity,
      departureAt: input.departureAt,
      pricePerSeat: input.pricePerSeat,
      seatsTotal: input.seatsTotal,
      comment: input.comment ?? null,
      meetingPoint: input.meetingPoint ?? null,
      templateId: input.templateId ?? null,
    });
  return getRide(Number(info.lastInsertRowid))!;
}

export function getRide(id: number): RideRecord | undefined {
  return db.prepare('SELECT * FROM rides WHERE id = ?').get(id) as RideRecord | undefined;
}

const RIDE_WITH_DRIVER_SELECT = `
  SELECT r.*,
         u.first_name AS driver_first_name,
         u.username   AS driver_username,
         u.full_name  AS driver_full_name,
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

export function searchRides(filter: {
  fromCity?: City;
  toCity?: City;
  onlyAvailable?: boolean;
  date?: string; // 'YYYY-MM-DD'
  minSeats?: number;
  minRating?: number;
  sort?: 'time' | 'price';
}): RideWithDriver[] {
  const clauses = [`r.status = 'active'`, `datetime(r.departure_at) >= datetime('now')`, `u.banned = 0`];
  const params: Record<string, unknown> = {};
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
    clauses.push("date(r.departure_at, '+5 hours') = @date");
    params.date = filter.date;
  }
  if (filter.minSeats) {
    clauses.push('r.seats_available >= @minSeats');
    params.minSeats = filter.minSeats;
  }
  if (filter.minRating) {
    clauses.push('COALESCE(rt.avg_rating, 0) >= @minRating');
    params.minRating = filter.minRating;
  }
  const orderBy = filter.sort === 'price' ? 'r.price_per_seat ASC, r.departure_at ASC' : 'r.departure_at ASC';
  const sql = `${RIDE_WITH_DRIVER_SELECT} WHERE ${clauses.join(' AND ')} ORDER BY ${orderBy}`;
  return db.prepare(sql).all(params) as RideWithDriver[];
}

export function getRideWithDriver(id: number): RideWithDriver | undefined {
  return db.prepare(`${RIDE_WITH_DRIVER_SELECT} WHERE r.id = @id`).get({ id }) as
    | RideWithDriver
    | undefined;
}

export function listAllRides(): RideWithDriver[] {
  return db
    .prepare(`${RIDE_WITH_DRIVER_SELECT} ORDER BY r.departure_at ASC`)
    .all() as RideWithDriver[];
}

export function listRidesByDriver(
  driverId: number,
  range?: { from: string; to: string }
): RideRecord[] {
  const clauses = ['driver_id = @driverId'];
  const params: Record<string, unknown> = { driverId };
  if (range) {
    clauses.push("date(departure_at, '+5 hours') BETWEEN @from AND @to");
    params.from = range.from;
    params.to = range.to;
  }
  return db
    .prepare(`SELECT * FROM rides WHERE ${clauses.join(' AND ')} ORDER BY departure_at DESC`)
    .all(params) as RideRecord[];
}

export function cancelRide(id: number, driverId: number): boolean {
  const info = db
    .prepare(
      `UPDATE rides SET status = 'cancelled', cancelled_at = datetime('now')
       WHERE id = ? AND driver_id = ? AND status = 'active'`
    )
    .run(id, driverId);
  return info.changes > 0;
}

/** Сколько поездок водитель отменил сам — сигнал для модерации в админке. */
export function countCancelledRidesByDriver(driverId: number): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM rides WHERE driver_id = ? AND cancelled_at IS NOT NULL`)
    .get(driverId) as { n: number };
  return row.n;
}

export function decrementSeats(rideId: number, seats: number): boolean {
  const info = db
    .prepare(
      `UPDATE rides SET seats_available = seats_available - ?
       WHERE id = ? AND seats_available >= ? AND status = 'active'`
    )
    .run(seats, rideId, seats);
  return info.changes > 0;
}

export function incrementSeats(rideId: number, seats: number): void {
  db.prepare(
    `UPDATE rides SET seats_available = MIN(seats_total, seats_available + ?) WHERE id = ?`
  ).run(seats, rideId);
}

/**
 * Автоматически подводит итог по поездкам, время которых прошло, а водитель
 * их не отменил вручную: если у поездки есть хотя бы одна подтверждённая
 * бронь — она становится «выполнена», иначе — «отменена». Заодно отменяет
 * зависшие неподтверждённые заявки на такие поездки (водитель не успел
 * отреагировать — поездка уже не наступит) и возвращает по ним места.
 */
export const sweepExpiredRides = db.transaction((): void => {
  const stalePending = db
    .prepare(
      `SELECT b.id, b.ride_id, b.seats_booked FROM bookings b
       JOIN rides r ON r.id = b.ride_id
       WHERE b.status = 'pending' AND r.status = 'active' AND datetime(r.departure_at) < datetime('now')`
    )
    .all() as { id: number; ride_id: number; seats_booked: number }[];
  for (const b of stalePending) {
    db.prepare(`UPDATE bookings SET status = 'cancelled' WHERE id = ?`).run(b.id);
    incrementSeats(b.ride_id, b.seats_booked);
  }

  db.prepare(
    `UPDATE rides SET status = 'completed'
     WHERE status = 'active' AND datetime(departure_at) < datetime('now')
       AND EXISTS (SELECT 1 FROM bookings b WHERE b.ride_id = rides.id AND b.status = 'confirmed')`
  ).run();

  db.prepare(
    `UPDATE rides SET status = 'cancelled'
     WHERE status = 'active' AND datetime(departure_at) < datetime('now')
       AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.ride_id = rides.id AND b.status = 'confirmed')`
  ).run();
});

export interface DepartureReminder {
  ride_id: number;
  from_city: City;
  to_city: City;
  departure_at: string;
  meeting_point: string | null;
  driver_id: number;
}

/** Активные поездки, которые отправляются в течение часа и по которым напоминание ещё не отправлено. */
export function listRidesDueForDepartureReminder(): DepartureReminder[] {
  return db
    .prepare(
      `SELECT id AS ride_id, from_city, to_city, departure_at, meeting_point, driver_id
       FROM rides
       WHERE status = 'active'
         AND departure_reminder_sent = 0
         AND datetime(departure_at) > datetime('now')
         AND datetime(departure_at) <= datetime('now', '+1 hour')`
    )
    .all() as DepartureReminder[];
}

export function markDepartureReminderSent(rideId: number): void {
  db.prepare(`UPDATE rides SET departure_reminder_sent = 1 WHERE id = ?`).run(rideId);
}
