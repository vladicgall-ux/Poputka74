import { db } from '../db/db';

export interface UserRecord {
  telegram_id: number;
  first_name: string;
  last_name: string | null;
  username: string | null;
  phone: string | null;
  phone_verified: number;
  banned: number;
  last_seen_at: string | null;
  created_at: string;
}

export interface DriverProfileRecord {
  telegram_id: number;
  car_model: string;
  car_color: string | null;
  car_plate: string;
  experience: string | null;
  photo_path: string | null;
  created_at: string;
}

export interface TelegramProfile {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
}

export function upsertUser(profile: TelegramProfile): UserRecord {
  // last_seen_at обновляется на каждый вызов — upsertUser выполняется
  // из requireTelegramAuth на любом запросе к API, это и есть метка "онлайн".
  db.prepare(
    `INSERT INTO users (telegram_id, first_name, last_name, username, last_seen_at)
     VALUES (@id, @first_name, @last_name, @username, datetime('now'))
     ON CONFLICT(telegram_id) DO UPDATE SET
       first_name = excluded.first_name,
       last_name = excluded.last_name,
       username = excluded.username,
       last_seen_at = datetime('now')`
  ).run({
    id: profile.id,
    first_name: profile.first_name,
    last_name: profile.last_name ?? null,
    username: profile.username ?? null,
  });
  return getUser(profile.id)!;
}

export function getUser(telegramId: number): UserRecord | undefined {
  return db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId) as
    | UserRecord
    | undefined;
}

export function setPhoneVerified(telegramId: number, phone: string): void {
  db.prepare(
    'UPDATE users SET phone = ?, phone_verified = 1 WHERE telegram_id = ?'
  ).run(phone, telegramId);
}

export function setUserBanned(telegramId: number, banned: boolean): void {
  db.prepare('UPDATE users SET banned = ? WHERE telegram_id = ?').run(banned ? 1 : 0, telegramId);
}

export interface UserWithDriverInfo extends UserRecord {
  car_model: string | null;
  car_plate: string | null;
  avg_rating: number | null;
  rating_count: number;
}

export function listAllUsers(): UserWithDriverInfo[] {
  return db
    .prepare(
      `SELECT u.*, d.car_model, d.car_plate,
              ROUND(r.avg_rating, 1) AS avg_rating, COALESCE(r.rating_count, 0) AS rating_count
       FROM users u
       LEFT JOIN driver_profiles d ON d.telegram_id = u.telegram_id
       LEFT JOIN (
         SELECT driver_id, AVG(rating) AS avg_rating, COUNT(*) AS rating_count
         FROM ratings GROUP BY driver_id
       ) r ON r.driver_id = u.telegram_id
       ORDER BY u.created_at DESC`
    )
    .all() as UserWithDriverInfo[];
}

export function getDriverProfile(telegramId: number): DriverProfileRecord | undefined {
  return db
    .prepare('SELECT * FROM driver_profiles WHERE telegram_id = ?')
    .get(telegramId) as DriverProfileRecord | undefined;
}

export function upsertDriverProfile(
  telegramId: number,
  data: { car_model: string; car_color?: string; car_plate: string; experience?: string }
): DriverProfileRecord {
  db.prepare(
    `INSERT INTO driver_profiles (telegram_id, car_model, car_color, car_plate, experience)
     VALUES (@telegramId, @car_model, @car_color, @car_plate, @experience)
     ON CONFLICT(telegram_id) DO UPDATE SET
       car_model = excluded.car_model,
       car_color = excluded.car_color,
       car_plate = excluded.car_plate,
       experience = excluded.experience`
  ).run({
    telegramId,
    car_model: data.car_model,
    car_color: data.car_color ?? null,
    car_plate: data.car_plate,
    experience: data.experience ?? null,
  });
  return getDriverProfile(telegramId)!;
}

export function setDriverPhoto(telegramId: number, photoPath: string): void {
  db.prepare('UPDATE driver_profiles SET photo_path = ? WHERE telegram_id = ?').run(
    photoPath,
    telegramId
  );
}
