"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = void 0;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const config_1 = require("../config");
const dbDir = path_1.default.dirname(config_1.config.dbPath);
if (!fs_1.default.existsSync(dbDir)) {
    fs_1.default.mkdirSync(dbDir, { recursive: true });
}
exports.db = new better_sqlite3_1.default(config_1.config.dbPath);
exports.db.pragma('journal_mode = WAL');
exports.db.pragma('foreign_keys = ON');
const schema = fs_1.default.readFileSync(path_1.default.join(__dirname, 'schema.sql'), 'utf-8');
exports.db.exec(schema);
/**
 * Лёгкие миграции для баз, созданных до появления фото водителя и
 * подтверждения брони. SQLite не умеет ALTER TABLE на CHECK-ограничения,
 * поэтому для bookings делаем пересборку таблицы; для driver_profiles
 * достаточно ADD COLUMN.
 */
function columnExists(table, column) {
    const columns = exports.db.prepare(`PRAGMA table_info(${table})`).all();
    return columns.some((c) => c.name === column);
}
if (!columnExists('driver_profiles', 'photo_path')) {
    exports.db.exec(`ALTER TABLE driver_profiles ADD COLUMN photo_path TEXT`);
}
if (!columnExists('users', 'banned')) {
    exports.db.exec(`ALTER TABLE users ADD COLUMN banned INTEGER NOT NULL DEFAULT 0`);
}
if (!columnExists('users', 'last_seen_at')) {
    exports.db.exec(`ALTER TABLE users ADD COLUMN last_seen_at TEXT`);
}
if (!columnExists('support_messages', 'from_admin')) {
    exports.db.exec(`ALTER TABLE support_messages ADD COLUMN from_admin INTEGER NOT NULL DEFAULT 0`);
}
if (!columnExists('bookings', 'reminder_sent')) {
    exports.db.exec(`ALTER TABLE bookings ADD COLUMN reminder_sent INTEGER NOT NULL DEFAULT 0`);
}
if (!columnExists('users', 'full_name')) {
    exports.db.exec(`ALTER TABLE users ADD COLUMN full_name TEXT`);
}
/**
 * Поддержка MAX как второй платформы. users.telegram_id остаётся PK без
 * перестройки таблицы (и без риска для всех FK на неё в driver_profiles/
 * rides/bookings/ratings) — пользователей MAX храним в том же столбце, но
 * их реальный numeric user_id записываем со знаком минус. Telegram ID
 * всегда положительные, поэтому коллизий быть не может, а конвертация
 * туда-обратно — это просто Math.abs(). platform — только для отображения
 * и для выбора, через какого бота отправлять уведомление.
 */
if (!columnExists('users', 'platform')) {
    exports.db.exec(`ALTER TABLE users ADD COLUMN platform TEXT NOT NULL DEFAULT 'telegram' CHECK (platform IN ('telegram','max'))`);
}
const bookingsTableSql = exports.db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'bookings'`).get()?.sql;
if (bookingsTableSql && !bookingsTableSql.includes("'pending'")) {
    exports.db.exec(`
    BEGIN TRANSACTION;
    ALTER TABLE bookings RENAME TO bookings_old;
    CREATE TABLE bookings (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      ride_id       INTEGER NOT NULL REFERENCES rides(id),
      passenger_id  INTEGER NOT NULL REFERENCES users(telegram_id),
      seats_booked  INTEGER NOT NULL CHECK (seats_booked BETWEEN 1 AND 8),
      status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','cancelled')),
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO bookings SELECT * FROM bookings_old;
    DROP TABLE bookings_old;
    CREATE INDEX IF NOT EXISTS idx_bookings_ride ON bookings (ride_id, status);
    CREATE INDEX IF NOT EXISTS idx_bookings_passenger ON bookings (passenger_id, status);
    COMMIT;
  `);
}
if (!columnExists('rides', 'meeting_point')) {
    exports.db.exec(`ALTER TABLE rides ADD COLUMN meeting_point TEXT`);
}
if (!columnExists('rides', 'departure_reminder_sent')) {
    exports.db.exec(`ALTER TABLE rides ADD COLUMN departure_reminder_sent INTEGER NOT NULL DEFAULT 0`);
}
if (!columnExists('rides', 'template_id')) {
    exports.db.exec(`ALTER TABLE rides ADD COLUMN template_id INTEGER REFERENCES ride_templates(id)`);
}
if (!columnExists('rides', 'cancelled_at')) {
    exports.db.exec(`ALTER TABLE rides ADD COLUMN cancelled_at TEXT`);
}
if (!columnExists('bookings', 'cancelled_at')) {
    exports.db.exec(`ALTER TABLE bookings ADD COLUMN cancelled_at TEXT`);
}
if (!columnExists('rides', 'dropoff_point')) {
    exports.db.exec(`ALTER TABLE rides ADD COLUMN dropoff_point TEXT`);
}
if (!columnExists('ride_templates', 'dropoff_point')) {
    exports.db.exec(`ALTER TABLE ride_templates ADD COLUMN dropoff_point TEXT`);
}
if (!columnExists('rides', 'cancellation_reason')) {
    exports.db.exec(`ALTER TABLE rides ADD COLUMN cancellation_reason TEXT`);
}
if (!columnExists('users', 'phone_reminder_sent_at')) {
    exports.db.exec(`ALTER TABLE users ADD COLUMN phone_reminder_sent_at TEXT`);
}
