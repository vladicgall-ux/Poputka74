"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.upsertUser = upsertUser;
exports.getUser = getUser;
exports.setPhoneVerified = setPhoneVerified;
exports.listAllUsers = listAllUsers;
exports.getDriverProfile = getDriverProfile;
exports.upsertDriverProfile = upsertDriverProfile;
exports.setDriverPhoto = setDriverPhoto;
const db_1 = require("../db/db");
function upsertUser(profile) {
    db_1.db.prepare(`INSERT INTO users (telegram_id, first_name, last_name, username)
     VALUES (@id, @first_name, @last_name, @username)
     ON CONFLICT(telegram_id) DO UPDATE SET
       first_name = excluded.first_name,
       last_name = excluded.last_name,
       username = excluded.username`).run({
        id: profile.id,
        first_name: profile.first_name,
        last_name: profile.last_name ?? null,
        username: profile.username ?? null,
    });
    return getUser(profile.id);
}
function getUser(telegramId) {
    return db_1.db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
}
function setPhoneVerified(telegramId, phone) {
    db_1.db.prepare('UPDATE users SET phone = ?, phone_verified = 1 WHERE telegram_id = ?').run(phone, telegramId);
}
function listAllUsers() {
    return db_1.db
        .prepare(`SELECT u.*, d.car_model, d.car_plate
       FROM users u
       LEFT JOIN driver_profiles d ON d.telegram_id = u.telegram_id
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
