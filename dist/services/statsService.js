"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAdminStats = getAdminStats;
const db_1 = require("../db/db");
/**
 * "Онлайн" — грубая оценка: пользователи, чей last_seen_at (обновляется на
 * каждом запросе к API) попадает в последние 5 минут. У Mini App нет
 * постоянного соединения, поэтому это приближение по недавней активности,
 * а не точный счётчик открытых сессий.
 */
function getAdminStats() {
    const totalUsers = db_1.db.prepare(`SELECT COUNT(*) AS n FROM users`).get().n;
    const onlineUsers = db_1.db
        .prepare(`SELECT COUNT(*) AS n FROM users WHERE last_seen_at >= datetime('now', '-5 minutes')`)
        .get().n;
    const verifiedUsers = db_1.db.prepare(`SELECT COUNT(*) AS n FROM users WHERE phone_verified = 1`).get().n;
    const drivers = db_1.db.prepare(`SELECT COUNT(*) AS n FROM driver_profiles`).get().n;
    const bannedUsers = db_1.db.prepare(`SELECT COUNT(*) AS n FROM users WHERE banned = 1`).get()
        .n;
    const activeRides = db_1.db.prepare(`SELECT COUNT(*) AS n FROM rides WHERE status = 'active'`).get().n;
    const totalBookings = db_1.db.prepare(`SELECT COUNT(*) AS n FROM bookings WHERE status IN ('pending','confirmed')`).get().n;
    return { totalUsers, onlineUsers, verifiedUsers, drivers, bannedUsers, activeRides, totalBookings };
}
