import crypto from 'crypto';
import { config } from '../config';
import type { MaxProfile } from '../services/userService';

export interface ValidatedMaxInitData {
  user: MaxProfile;
  authDate: number;
}

/**
 * Проверяет подпись initData из MAX Mini App.
 *
 * ВАЖНО: dev.max.ru (единственный официальный источник точной формулы)
 * был недоступен из этой сессии — сеть блокирует egress на этот домен.
 * Подтверждено из открытых источников только то, что MAX Bridge отдаёт
 * initData тем же набором полей, что и Telegram (query_id, auth_date,
 * hash, user.{id,first_name,last_name,username,language_code,photo_url},
 * start_param) — MAX сознательно скопировал схему Telegram Mini Apps.
 * Поэтому здесь применён ТОТ ЖЕ алгоритм, что и для Telegram
 * (validateInitData в telegramAuth.ts): HMAC-SHA256 от отсортированной
 * data-check-string, ключ — HMAC-SHA256('WebAppData', токен бота).
 *
 * Это лучшее обоснованное предположение, а не подтверждённый факт. Перед
 * тем как полагаться на это в проде, нужно получить реальный initData от
 * живого MAX Mini App (залогировать сырую строку на сервере при первом
 * запросе) и свериться с этой реализацией — если MAX использует другую
 * секретную строку вместо 'WebAppData' или другой набор полей, здесь
 * потребуется только эта константа, остальной алгоритм неизменен.
 */
export function validateMaxInitData(initData: string): ValidatedMaxInitData | null {
  // ВРЕМЕННАЯ диагностика, пока алгоритм не подтверждён на реальных данных
  // MAX — убрать после того, как автаризация MAX заработает. Не логируем
  // ничего, если запроса вообще не было (initData пустая — это норма для
  // каждого обычного Telegram-запроса, идущего через тот же миддлвар).
  const log = (reason: string) => console.log(`[maxAuth] отклонено: ${reason}. initData="${initData}"`);

  if (!initData) {
    log('X-Max-Init-Data пустой или отсутствует — фронтенд не получил initData от MAX Bridge');
    return null;
  }
  if (!config.maxBotToken) {
    log('MAX_BOT_TOKEN не задан на сервере');
    return null;
  }

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) {
    log('нет поля hash');
    return null;
  }
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(config.maxBotToken).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (!timingSafeEqualHex(computedHash, hash)) {
    log(`подпись не совпала (ожидали ${computedHash}, получили ${hash}, dataCheckString="${dataCheckString}")`);
    return null;
  }

  const authDate = Number(params.get('auth_date') ?? 0);
  if (!authDate || Date.now() / 1000 - authDate > 60 * 60 * 24) {
    log(`просрочено или нет auth_date (${params.get('auth_date')})`);
    return null;
  }

  const userRaw = params.get('user');
  if (!userRaw) {
    log('нет поля user');
    return null;
  }

  const parsed = JSON.parse(userRaw) as { id: number; first_name?: string; name?: string; username?: string };
  const user: MaxProfile = {
    id: parsed.id,
    name: parsed.name ?? parsed.first_name ?? 'Пользователь MAX',
    username: parsed.username ?? null,
  };
  return { user, authDate };
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
