"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSupportMessage = createSupportMessage;
exports.listAllSupportMessages = listAllSupportMessages;
const db_1 = require("../db/db");
function createSupportMessage(userId, message) {
    const info = db_1.db
        .prepare(`INSERT INTO support_messages (user_id, message) VALUES (?, ?)`)
        .run(userId, message);
    return db_1.db.prepare('SELECT * FROM support_messages WHERE id = ?').get(info.lastInsertRowid);
}
function listAllSupportMessages() {
    return db_1.db
        .prepare(`SELECT s.*, u.first_name, u.username, u.phone
       FROM support_messages s JOIN users u ON u.telegram_id = s.user_id
       ORDER BY s.created_at DESC`)
        .all();
}
