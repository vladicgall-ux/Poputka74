"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.upsertUser = upsertUser;
exports.getUser = getUser;
exports.maxStorageId = maxStorageId;
exports.realMaxUserId = realMaxUserId;
exports.upsertMaxUser = upsertMaxUser;
exports.setPhoneVerified = setPhoneVerified;
exports.setUserBanned = setUserBanned;
exports.listUsersDueForPhoneReminder = listUsersDueForPhoneReminder;
exports.markPhoneReminderSent = markPhoneReminderSent;
exports.setFullName = setFullName;
exports.listActiveUserIds = listActiveUserIds;
exports.listAllUsers = listAllUsers;
exports.getDriverProfile = getDriverProfile;
exports.upsertDriverProfile = upsertDriverProfile;
exports.setDriverPhoto = setDriverPhoto;
const db_1 = require("../db/db");
const LAST_SEEN_THROTTLE_MS = 5 * 60000;
function upsertUser(profile) {
    const existing = getUser(profile.id);
    const lastName = profile.last_name ?? null;
    const username = profile.username ?? null;
    // requireTelegramAuth вызывает upsertUser на КАЖДЫЙ запрос к API — если
    // пользователь уже есть, профиль не изменился и last_seen_at свежее
    // 5 минут, пропускаем запись вовсе: незачем на каждый GET дёргать диск
    // одним и тем же значением last_seen_at.
    if (existing &&
        existing.first_name === profile.first_name &&
        existing.last_name === lastName &&
        existing.username === username &&
        existing.last_seen_at &&
        Date.now() - Date.parse(existing.last_seen_at + 'Z') < LAST_SEEN_THROTTLE_MS) {
        return existing;
    }
    db_1.db.prepare(`INSERT INTO users (telegram_id, first_name, last_name, username, last_seen_at)
     VALUES (@id, @first_name, @last_name, @username, datetime('now'))
     ON CONFLICT(telegram_id) DO UPDATE SET
       first_name = excluded.first_name,
       last_name = excluded.last_name,
       username = excluded.username,
       last_seen_at = datetime('now')`).run({
        id: profile.id,
        first_name: profile.first_name,
        last_name: lastName,
        username,
    });
    return getUser(profile.id);
}
function getUser(telegramId) {
    return db_1.db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
}
/**
 * Регистрирует/обновляет пользователя MAX в той же таблице users, что и
 * Telegram. Реальный numeric user_id MAX хранится в telegram_id со знаком
 * минус — Telegram ID всегда положительные, так что коллизий не бывает, и
 * не пришлось перестраивать таблицу и все внешние ключи на неё
 * (driver_profiles/rides/bookings/ratings). platform='max' — только для
 * отображения и выбора бота при отправке уведомлений.
 */
function maxStorageId(realMaxUserId) {
    return -Math.abs(realMaxUserId);
}
function realMaxUserId(user) {
    return Math.abs(user.telegram_id);
}
function upsertMaxUser(profile) {
    const storageId = maxStorageId(profile.id);
    const existing = getUser(storageId);
    const username = profile.username ?? null;
    // См. комментарий в upsertUser() — та же троттлинг-логика для MAX.
    if (existing &&
        existing.first_name === profile.name &&
        existing.username === username &&
        existing.last_seen_at &&
        Date.now() - Date.parse(existing.last_seen_at + 'Z') < LAST_SEEN_THROTTLE_MS) {
        return existing;
    }
    db_1.db.prepare(`INSERT INTO users (telegram_id, platform, first_name, username, last_seen_at)
     VALUES (@id, 'max', @first_name, @username, datetime('now'))
     ON CONFLICT(telegram_id) DO UPDATE SET
       first_name = excluded.first_name,
       username = excluded.username,
       last_seen_at = datetime('now')`).run({ id: storageId, first_name: profile.name, username });
    return getUser(storageId);
}
function setPhoneVerified(telegramId, phone) {
    db_1.db.prepare('UPDATE users SET phone = ?, phone_verified = 1 WHERE telegram_id = ?').run(phone, telegramId);
}
function setUserBanned(telegramId, banned) {
    db_1.db.prepare('UPDATE users SET banned = ? WHERE telegram_id = ?').run(banned ? 1 : 0, telegramId);
}
/**
 * Пользователи, кому пора напомнить подтвердить телефон — раз в 6 часов, пока
 * не подтвердят. Первое напоминание — через 6 часов после регистрации (сразу
 * дублировать /start было бы навязчиво), дальше — через 6 часов после
 * предыдущего напоминания. COALESCE позволяет использовать одно условие
 * для обоих случаев (ещё не напоминали vs уже напоминали раньше).
 */
function listUsersDueForPhoneReminder() {
    return db_1.db
        .prepare(`SELECT * FROM users
       WHERE phone_verified = 0 AND banned = 0
         AND COALESCE(phone_reminder_sent_at, created_at) <= datetime('now', '-6 hours')`)
        .all();
}
function markPhoneReminderSent(telegramId) {
    db_1.db.prepare(`UPDATE users SET phone_reminder_sent_at = datetime('now') WHERE telegram_id = ?`).run(telegramId);
}
/** Настоящее имя и фамилия, которые пользователь вводит сам — в отличие от
 *  first_name/username из Telegram, это может быть любой ник. Показывается
 *  другой стороне (пассажиру/водителю) вместо телеграм-ника. */
function setFullName(telegramId, fullName) {
    db_1.db.prepare('UPDATE users SET full_name = ? WHERE telegram_id = ?').run(fullName, telegramId);
}
/** ID всех незаблокированных пользователей — получатели рассылки из админки. */
function listActiveUserIds() {
    return db_1.db.prepare(`SELECT telegram_id FROM users WHERE banned = 0`).all().map((r) => r.telegram_id);
}
function listAllUsers() {
    return db_1.db
        .prepare(`SELECT u.*, d.car_model, d.car_plate,
              ROUND(r.avg_rating, 1) AS avg_rating, COALESCE(r.rating_count, 0) AS rating_count
       FROM users u
       LEFT JOIN driver_profiles d ON d.telegram_id = u.telegram_id
       LEFT JOIN (
         SELECT driver_id, AVG(rating) AS avg_rating, COUNT(*) AS rating_count
         FROM ratings GROUP BY driver_id
       ) r ON r.driver_id = u.telegram_id
       ORDER BY u.created_at DESC`)
        .all();
}
function getDriverProfile(telegramId) {
    return db_1.db
        .prepare('SELECT * FROM driver_profiles WHERE telegram_id = ?')
        .get(telegramId);
}
function upsertDriverProfile(telegramId, data) {
    db_1.db.prepare(`INSERT INTO driver_profiles (telegram_id, car_model, car_color, car_plate, experience)
     VALUES (@telegramId, @car_model, @car_color, @car_plate, @experience)
     ON CONFLICT(telegram_id) DO UPDATE SET
       car_model = excluded.car_model,
       car_color = excluded.car_color,
       car_plate = excluded.car_plate,
       experience = excluded.experience`).run({
        telegramId,
        car_model: data.car_model,
        car_color: data.car_color ?? null,
        car_plate: data.car_plate,
        experience: data.experience ?? null,
    });
    return getDriverProfile(telegramId);
}
function setDriverPhoto(telegramId, photoPath) {
    db_1.db.prepare('UPDATE driver_profiles SET photo_path = ? WHERE telegram_id = ?').run(photoPath, telegramId);
}
