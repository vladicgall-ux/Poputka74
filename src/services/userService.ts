import { db } from '../db/db';

export type Platform = 'telegram' | 'max';

export interface UserRecord {
  telegram_id: number;
  first_name: string;
  last_name: string | null;
  username: string | null;
  phone: string | null;
  phone_verified: number;
  banned: number;
  last_seen_at: string | null;
  full_name: string | null;
  platform: Platform;
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

export interface MaxProfile {
  id: number;
  name: string;
  username?: string | null;
}

/**
 * Регистрирует/обновляет пользователя MAX в той же таблице users, что и
 * Telegram. Реальный numeric user_id MAX хранится в telegram_id со знаком
 * минус — Telegram ID всегда положительные, так что коллизий не бывает, и
 * не пришлось перестраивать таблицу и все внешние ключи на неё
 * (driver_profiles/rides/bookings/ratings). platform='max' — только для
 * отображения и выбора бота при отправке уведомлений.
 */
export function maxStorageId(realMaxUserId: number): number {
  return -Math.abs(realMaxUserId);
}

export function realMaxUserId(user: Pick<UserRecord, 'telegram_id'>): number {
  return Math.abs(user.telegram_id);
}

export function upsertMaxUser(profile: MaxProfile): UserRecord {
  const storageId = maxStorageId(profile.id);
  db.prepare(
    `INSERT INTO users (telegram_id, platform, first_name, username, last_seen_at)
     VALUES (@id, 'max', @first_name, @username, datetime('now'))
     ON CONFLICT(telegram_id) DO UPDATE SET
       first_name = excluded.first_name,
       username = excluded.username,
       last_seen_at = datetime('now')`
  ).run({ id: storageId, first_name: profile.name, username: profile.username ?? null });
  return getUser(storageId)!;
}

export function setPhoneVerified(telegramId: number, phone: string): void {
  db.prepare(
    'UPDATE users SET phone = ?, phone_verified = 1 WHERE telegram_id = ?'
  ).run(phone, telegramId);
}

export function setUserBanned(telegramId: number, banned: boolean): void {
  db.prepare('UPDATE users SET banned = ? WHERE telegram_id = ?').run(banned ? 1 : 0, telegramId);
}

/** Настоящее имя и фамилия, которые пользователь вводит сам — в отличие от
 *  first_name/username из Telegram, это может быть любой ник. Показывается
 *  другой стороне (пассажиру/водителю) вместо телеграм-ника. */
export function setFullName(telegramId: number, fullName: string): void {
  db.prepare('UPDATE users SET full_name = ? WHERE telegram_id = ?').run(fullName, telegramId);
}

export interface UserWithDriverInfo extends UserRecord {
  car_model: string | null;
  car_plate: string | null;
  avg_rating: number | null;
  rating_count: number;
}

/** ID всех незаблокированных пользователей — получатели рассылки из админки. */
export function listActiveUserIds(): number[] {
  return (db.prepare(`SELECT telegram_id FROM users WHERE banned = 0`).all() as { telegram_id: number }[]).map(
    (r) => r.telegram_id
  );
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
