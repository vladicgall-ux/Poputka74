import { db } from '../db/db';

export interface AdminStats {
  totalUsers: number;
  onlineUsers: number;
  verifiedUsers: number;
  drivers: number;
  bannedUsers: number;
  activeRides: number;
  totalBookings: number;
}

/**
 * "Онлайн" — грубая оценка: пользователи, чей last_seen_at (обновляется на
 * каждом запросе к API) попадает в последние 5 минут. У Mini App нет
 * постоянного соединения, поэтому это приближение по недавней активности,
 * а не точный счётчик открытых сессий.
 */
export function getAdminStats(): AdminStats {
  const totalUsers = (db.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number }).n;
  const onlineUsers = (
    db
      .prepare(`SELECT COUNT(*) AS n FROM users WHERE last_seen_at >= datetime('now', '-5 minutes')`)
      .get() as { n: number }
  ).n;
  const verifiedUsers = (
    db.prepare(`SELECT COUNT(*) AS n FROM users WHERE phone_verified = 1`).get() as { n: number }
  ).n;
  const drivers = (db.prepare(`SELECT COUNT(*) AS n FROM driver_profiles`).get() as { n: number }).n;
  const bannedUsers = (db.prepare(`SELECT COUNT(*) AS n FROM users WHERE banned = 1`).get() as { n: number })
    .n;
  const activeRides = (
    db.prepare(`SELECT COUNT(*) AS n FROM rides WHERE status = 'active'`).get() as { n: number }
  ).n;
  const totalBookings = (
    db.prepare(`SELECT COUNT(*) AS n FROM bookings WHERE status IN ('pending','confirmed')`).get() as {
      n: number;
    }
  ).n;

  return { totalUsers, onlineUsers, verifiedUsers, drivers, bannedUsers, activeRides, totalBookings };
}
