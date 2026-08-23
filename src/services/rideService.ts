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
  status: 'active' | 'cancelled' | 'completed';
  created_at: string;
}

export interface RideWithDriver extends RideRecord {
  driver_first_name: string;
  driver_username: string | null;
  car_model: string;
  car_color: string | null;
  car_plate: string;
  photo_path: string | null;
}

export function createRide(input: {
  driverId: number;
  fromCity: City;
  toCity: City;
  departureAt: string;
  pricePerSeat: number;
  seatsTotal: number;
  comment?: string;
}): RideRecord {
  const info = db
    .prepare(
      `INSERT INTO rides (driver_id, from_city, to_city, departure_at, price_per_seat, seats_total, seats_available, comment)
       VALUES (@driverId, @fromCity, @toCity, @departureAt, @pricePerSeat, @seatsTotal, @seatsTotal, @comment)`
    )
    .run({
      driverId: input.driverId,
      fromCity: input.fromCity,
      toCity: input.toCity,
      departureAt: input.departureAt,
      pricePerSeat: input.pricePerSeat,
      seatsTotal: input.seatsTotal,
      comment: input.comment ?? null,
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
         d.car_model, d.car_color, d.car_plate, d.photo_path
  FROM rides r
  JOIN users u ON u.telegram_id = r.driver_id
  JOIN driver_profiles d ON d.telegram_id = r.driver_id
`;

export function searchRides(filter: {
  fromCity?: City;
  toCity?: City;
  onlyAvailable?: boolean;
}): RideWithDriver[] {
  const clauses = [`r.status = 'active'`, `r.departure_at >= datetime('now', '-1 hour')`, `u.banned = 0`];
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
  const sql = `${RIDE_WITH_DRIVER_SELECT} WHERE ${clauses.join(' AND ')} ORDER BY r.departure_at ASC`;
  return db.prepare(sql).all(params) as RideWithDriver[];
}

export function getRideWithDriver(id: number): RideWithDriver | undefined {
  return db.prepare(`${RIDE_WITH_DRIVER_SELECT} WHERE r.id = @id`).get({ id }) as
    | RideWithDriver
    | undefined;
}

export function listAllRides(): RideWithDriver[] {
  return db
    .prepare(`${RIDE_WITH_DRIVER_SELECT} ORDER BY r.created_at DESC`)
    .all() as RideWithDriver[];
}

export function listRidesByDriver(driverId: number): RideRecord[] {
  return db
    .prepare(`SELECT * FROM rides WHERE driver_id = ? ORDER BY departure_at DESC`)
    .all(driverId) as RideRecord[];
}

export function cancelRide(id: number, driverId: number): boolean {
  const info = db
    .prepare(`UPDATE rides SET status = 'cancelled' WHERE id = ? AND driver_id = ? AND status = 'active'`)
    .run(id, driverId);
  return info.changes > 0;
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
