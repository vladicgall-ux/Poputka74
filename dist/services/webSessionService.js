"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createWebSession = createWebSession;
exports.getSessionUser = getSessionUser;
exports.deleteWebSession = deleteWebSession;
exports.createMaxLoginCode = createMaxLoginCode;
exports.consumeMaxLoginCode = consumeMaxLoginCode;
exports.checkMaxLoginCode = checkMaxLoginCode;
exports.sweepExpiredWebAuth = sweepExpiredWebAuth;
const crypto_1 = __importDefault(require("crypto"));
const db_1 = require("../db/db");
const userService_1 = require("./userService");
const SESSION_TTL_MS = 30 * 24 * 60 * 60000; // 30 дней
const MAX_CODE_TTL_MS = 10 * 60000; // 10 минут — код успевают ввести, но он не живёт вечно
function isoIn(ms) {
    return new Date(Date.now() + ms).toISOString();
}
function createWebSession(userId) {
    const token = crypto_1.default.randomBytes(32).toString('hex');
    db_1.db.prepare('INSERT INTO web_sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, isoIn(SESSION_TTL_MS));
    return token;
}
function getSessionUser(token) {
    if (!token)
        return undefined;
    const row = db_1.db
        .prepare('SELECT user_id FROM web_sessions WHERE token = ? AND expires_at > datetime(\'now\')')
        .get(token);
    return row ? (0, userService_1.getUser)(row.user_id) : undefined;
}
function deleteWebSession(token) {
    db_1.db.prepare('DELETE FROM web_sessions WHERE token = ?').run(token);
}
/**
 * Генерируем короткий числовой код (его нужно набрать/скопировать в чат
 * с ботом MAX) — на случай коллизии с ещё не истёкшим чужим кодом просто
 * пробуем снова, коллизии крайне редки (обычно живут не больше 10 минут
 * и их считаные единицы одновременно).
 */
function createMaxLoginCode() {
    for (let attempt = 0; attempt < 10; attempt += 1) {
        const code = String(crypto_1.default.randomInt(0, 1000000)).padStart(6, '0');
        const exists = db_1.db.prepare('SELECT 1 FROM max_login_codes WHERE code = ?').get(code);
        if (exists)
            continue;
        db_1.db.prepare('INSERT INTO max_login_codes (code, expires_at) VALUES (?, ?)').run(code, isoIn(MAX_CODE_TTL_MS));
        return code;
    }
    throw new Error('Не удалось сгенерировать код входа, попробуйте ещё раз');
}
/** Привязывает код к пользователю MAX, который прислал его боту. */
function consumeMaxLoginCode(code, userId) {
    const result = db_1.db
        .prepare(`UPDATE max_login_codes SET user_id = ?
       WHERE code = ? AND expires_at > datetime('now') AND user_id IS NULL`)
        .run(userId, code);
    return result.changes > 0;
}
/** Опрос со страницы браузера: подтверждён ли код и кем. */
function checkMaxLoginCode(code) {
    const row = db_1.db
        .prepare(`SELECT user_id FROM max_login_codes WHERE code = ? AND expires_at > datetime('now')`)
        .get(code);
    return row?.user_id ?? null;
}
/** Чистит истёкшие сессии и коды — вызывается из периодических задач в index.ts. */
function sweepExpiredWebAuth() {
    db_1.db.prepare(`DELETE FROM web_sessions WHERE expires_at <= datetime('now')`).run();
    db_1.db.prepare(`DELETE FROM max_login_codes WHERE expires_at <= datetime('now')`).run();
}
