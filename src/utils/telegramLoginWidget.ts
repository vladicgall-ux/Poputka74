import crypto from 'crypto';
import { config } from '../config';

export interface TelegramWidgetProfile {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
}

/**
 * Проверка данных от Telegram Login Widget — это ОТДЕЛЬНЫЙ алгоритм от
 * validateInitData() в telegramAuth.ts (тот — для Mini App initData).
 * Разница в способе получения secret_key:
 * https://core.telegram.org/widgets/login#checking-authorization
 */
export function validateLoginWidgetData(
  data: Record<string, string | undefined>
): TelegramWidgetProfile | null {
  const hash = data.hash;
  if (!hash) return null;

  const dataCheckString = Object.keys(data)
    .filter((key) => key !== 'hash' && data[key] !== undefined)
    .sort()
    .map((key) => `${key}=${data[key]}`)
    .join('\n');

  const secretKey = crypto.createHash('sha256').update(config.botToken).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (!timingSafeEqualHex(computedHash, hash)) {
    return null;
  }

  const authDate = Number(data.auth_date ?? 0);
  if (!authDate || Date.now() / 1000 - authDate > 60 * 60 * 24) {
    return null;
  }

  const id = Number(data.id);
  if (!id || !data.first_name) return null;

  return {
    id,
    first_name: data.first_name,
    last_name: data.last_name,
    username: data.username,
  };
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
