import crypto from 'crypto';
import { db } from '../db/db';
import { getUser, type UserRecord } from './userService';

const SESSION_TTL_MS = 30 * 24 * 60 * 60_000; // 30 дней
const MAX_CODE_TTL_MS = 10 * 60_000; // 10 минут — код успевают ввести, но он не живёт вечно

function isoIn(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

export function createWebSession(userId: number): string {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO web_sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(
    token,
    userId,
    isoIn(SESSION_TTL_MS)
  );
  return token;
}

export function getSessionUser(token: string): UserRecord | undefined {
  if (!token) return undefined;
  const row = db
    .prepare('SELECT user_id FROM web_sessions WHERE token = ? AND expires_at > datetime(\'now\')')
    .get(token) as { user_id: number } | undefined;
  return row ? getUser(row.user_id) : undefined;
}

export function deleteWebSession(token: string): void {
  db.prepare('DELETE FROM web_sessions WHERE token = ?').run(token);
}

/**
 * Генерируем короткий числовой код (его нужно набрать/скопировать в чат
 * с ботом MAX) — на случай коллизии с ещё не истёкшим чужим кодом просто
 * пробуем снова, коллизии крайне редки (обычно живут не больше 10 минут
 * и их считаные единицы одновременно).
 */
export function createMaxLoginCode(): string {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    const exists = db.prepare('SELECT 1 FROM max_login_codes WHERE code = ?').get(code);
    if (exists) continue;
    db.prepare('INSERT INTO max_login_codes (code, expires_at) VALUES (?, ?)').run(code, isoIn(MAX_CODE_TTL_MS));
    return code;
  }
  throw new Error('Не удалось сгенерировать код входа, попробуйте ещё раз');
}

/** Привязывает код к пользователю MAX, который прислал его боту. */
export function consumeMaxLoginCode(code: string, userId: number): boolean {
  const result = db
    .prepare(
      `UPDATE max_login_codes SET user_id = ?
       WHERE code = ? AND expires_at > datetime('now') AND user_id IS NULL`
    )
    .run(userId, code);
  return result.changes > 0;
}

/** Опрос со страницы браузера: подтверждён ли код и кем. */
export function checkMaxLoginCode(code: string): number | null {
  const row = db
    .prepare(`SELECT user_id FROM max_login_codes WHERE code = ? AND expires_at > datetime('now')`)
    .get(code) as { user_id: number | null } | undefined;
  return row?.user_id ?? null;
}

/** Чистит истёкшие сессии и коды — вызывается из периодических задач в index.ts. */
export function sweepExpiredWebAuth(): void {
  db.prepare(`DELETE FROM web_sessions WHERE expires_at <= datetime('now')`).run();
  db.prepare(`DELETE FROM max_login_codes WHERE expires_at <= datetime('now')`).run();
}
