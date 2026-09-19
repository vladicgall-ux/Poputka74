import crypto from 'crypto';
import { config } from '../config';
import { parseInitData } from './initDataParser';
import type { TelegramProfile } from '../services/userService';

export interface ValidatedInitData {
  user: TelegramProfile;
  authDate: number;
}

/**
 * Проверяет подпись initData, которую Telegram Mini App передаёт на бэкенд.
 * Алгоритм из официальной документации Telegram (валидация Web App данных):
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * Разбор строки вынесен в initDataParser: там же проверяются размер,
 * кодировка, обязательные поля, дубликаты security-критичных параметров и
 * срок годности auth_date — всё это до вычисления HMAC, чтобы подпись
 * считалась только по данным заведомо понятной структуры.
 *
 * initData — не сессия. После успешной проверки вызывающий код выдаёт
 * серверную сессию (server/middleware/auth.ts), а окно годности самой
 * initData ограничено config.initDataMaxAgeSec.
 */
export function validateInitData(initData: string): ValidatedInitData | null {
  const parsed = parseInitData(initData, config.initDataMaxAgeSec);
  if (!parsed.ok) return null;

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(config.botToken).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(parsed.dataCheckString).digest('hex');

  if (!timingSafeEqualHex(computedHash, parsed.hash)) {
    return null;
  }

  let profile: unknown;
  try {
    profile = JSON.parse(parsed.userRaw);
  } catch {
    return null;
  }
  if (
    !profile ||
    typeof profile !== 'object' ||
    typeof (profile as { id?: unknown }).id !== 'number' ||
    !Number.isSafeInteger((profile as { id: number }).id) ||
    (profile as { id: number }).id <= 0 ||
    typeof (profile as { first_name?: unknown }).first_name !== 'string'
  ) {
    return null;
  }

  return { user: profile as TelegramProfile, authDate: parsed.authDate };
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
