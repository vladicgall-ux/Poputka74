import { db } from '../db/db';

export interface SupportMessageRecord {
  id: number;
  user_id: number;
  message: string;
  created_at: string;
}

export function createSupportMessage(userId: number, message: string): SupportMessageRecord {
  const info = db
    .prepare(`INSERT INTO support_messages (user_id, message) VALUES (?, ?)`)
    .run(userId, message);
  return db.prepare('SELECT * FROM support_messages WHERE id = ?').get(info.lastInsertRowid) as SupportMessageRecord;
}

export interface SupportMessageWithUser extends SupportMessageRecord {
  first_name: string;
  username: string | null;
  phone: string | null;
}

export function listAllSupportMessages(): SupportMessageWithUser[] {
  return db
    .prepare(
      `SELECT s.*, u.first_name, u.username, u.phone
       FROM support_messages s JOIN users u ON u.telegram_id = s.user_id
       ORDER BY s.created_at DESC`
    )
    .all() as SupportMessageWithUser[];
}
