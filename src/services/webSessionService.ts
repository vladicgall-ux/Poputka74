import crypto from 'crypto';
import { db } from '../db/db';
import { getUser, type UserRecord } from './userService';

const SESSION_TTL_MS = 30 * 24 * 60 * 60_000; // 30 дней
const LOGIN_CODE_TTL_MS = 10 * 60_000; // 10 минут — код успевают ввести, но он не живёт вечно

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
 * Короткий числовой код для входа в браузерной версии: пользователь
 * получает его на сайте и присылает боту в чат — в Telegram или в MAX,
 * какой удобнее (оба бота проверяют один и тот же код одинаково, разница
 * только в том, какой telegram_id к нему привяжется). На случай коллизии
 * с ещё не истёкшим чужим кодом просто пробуем снова — коллизии крайне
 * редки (код живёт не больше 10 минут, одновременно их считаные единицы).
 *
 * Код всего 6 цифр (1 млн комбинаций) — сам по себе он недостаточно
 * стойкий против перебора, если бы по нему одному выдавалась сессия.
 * Поэтому вместе с кодом генерируется длинный случайный pollToken:
 * он возвращается только этому браузеру (никогда не показывается
 * пользователю и не отправляется боту) и требуется вместе с кодом
 * при опросе /login-code/status — угадать оба значения одновременно
 * уже нереально.
 */
export function createLoginCode(): { code: string; pollToken: string } {
  const pollToken = crypto.randomBytes(24).toString('hex');
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    const exists = db.prepare('SELECT 1 FROM login_codes WHERE code = ?').get(code);
    if (exists) continue;
    db.prepare('INSERT INTO login_codes (code, poll_token, expires_at) VALUES (?, ?, ?)').run(
      code,
      pollToken,
      isoIn(LOGIN_CODE_TTL_MS)
    );
    return { code, pollToken };
  }
  throw new Error('Не удалось сгенерировать код входа, попробуйте ещё раз');
}

/** Привязывает код к пользователю, который прислал его боту (Telegram или MAX). */
export function consumeLoginCode(code: string, userId: number): boolean {
  const result = db
    .prepare(
      `UPDATE login_codes SET user_id = ?
       WHERE code = ? AND expires_at > datetime('now') AND user_id IS NULL`
    )
    .run(userId, code);
  return result.changes > 0;
}

/**
 * Опрос со страницы браузера: подтверждён ли код и кем. Требует pollToken,
 * выданный именно этому браузеру при создании кода — см. комментарий выше.
 *
 * Код одноразовый: как только по нему выдана сессия, отмечаем used_at —
 * иначе повторный опрос (два открытых окна с одним кодом, дублирующийся
 * тик polling-таймера) мог бы получить ещё одну валидную сессию по тому же
 * коду. Пометка использованным — отдельный атомарный UPDATE с проверкой
 * changes > 0, поэтому даже при двух одновременных вызовах сессию получит
 * только один из них.
 */
export function checkLoginCode(code: string, pollToken: string): number | null {
  if (!code || !pollToken) return null;
  const row = db
    .prepare(
      `SELECT user_id, poll_token FROM login_codes
       WHERE code = ? AND expires_at > datetime('now') AND used_at IS NULL`
    )
    .get(code) as { user_id: number | null; poll_token: string | null } | undefined;
  if (!row || !row.poll_token || row.user_id === null) return null;
  const expected = Buffer.from(row.poll_token);
  const actual = Buffer.from(pollToken);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;

  const result = db
    .prepare(`UPDATE login_codes SET used_at = datetime('now') WHERE code = ? AND used_at IS NULL`)
    .run(code);
  if (result.changes === 0) return null;

  return row.user_id;
}

/** Чистит истёкшие сессии и коды — вызывается из периодических задач в index.ts. */
export function sweepExpiredWebAuth(): void {
  db.prepare(`DELETE FROM web_sessions WHERE expires_at <= datetime('now')`).run();
  db.prepare(`DELETE FROM login_codes WHERE expires_at <= datetime('now')`).run();
}
