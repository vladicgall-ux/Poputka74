import crypto from 'crypto';
import { config } from '../config';
import { parseInitData } from './initDataParser';
import type { MaxProfile } from '../services/userService';

export interface ValidatedMaxInitData {
  user: MaxProfile;
  authDate: number;
}

/**
 * Проверяет подпись initData из MAX Mini App.
 *
 * Алгоритм подтверждён официальной документацией MAX (dev.max.ru/docs/
 * webapps/validation): та же схема, что и у Telegram Mini Apps —
 * HMAC-SHA256 от отсортированной data-check-string, ключ —
 * HMAC-SHA256('WebAppData', токен бота). Реализация ниже совпадает с
 * validateInitData в telegramAuth.ts, только с секретом MAX-бота, и
 * использует тот же строгий разбор (initDataParser): размер, кодировка,
 * обязательные поля, дубликаты security-критичных параметров, срок
 * годности auth_date и допуск на расхождение часов.
 *
 * Launch-параметры MAX — не постоянный API-токен: после успешной проверки
 * выдаётся серверная сессия в HttpOnly-куке (server/middleware/auth.ts),
 * а сами параметры живут не дольше config.initDataMaxAgeSec.
 */
export function validateMaxInitData(initData: string): ValidatedMaxInitData | null {
  // Логируем только короткую причину отказа, без самих данных — initData
  // содержит персональные данные пользователя MAX (id, имя, username), а
  // при неверной подписи ещё и посчитанный HMAC незачем писать в лог.
  const log = (reason: string) => console.log(`[maxAuth] отклонено: ${reason}`);

  // Пустой X-Max-Init-Data — это НЕ аномалия, а норма для подавляющего
  // большинства запросов: requireTelegramAuth вызывает эту функцию как
  // запасной вариант для КАЖДОГО запроса, у которого не прошла телеграмная
  // проверка, — а это в том числе и весь трафик браузерной версии сайта
  // (вход по коду, там нет ни Telegram, ни MAX initData вообще), и запросы
  // ботов/краулеров без какого-либо игрового контекста. Логировать здесь
  // значило бы писать в лог фактически на каждый обычный запрос сайта.
  if (!initData) {
    return null;
  }
  if (!config.maxBotToken) {
    log('MAX_BOT_TOKEN не задан на сервере');
    return null;
  }

  const parsed = parseInitData(initData, config.initDataMaxAgeSec);
  if (!parsed.ok) {
    log(parsed.reason);
    return null;
  }

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(config.maxBotToken).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(parsed.dataCheckString).digest('hex');

  if (!timingSafeEqualHex(computedHash, parsed.hash)) {
    log('подпись не совпала');
    return null;
  }

  let profile: unknown;
  try {
    profile = JSON.parse(parsed.userRaw);
  } catch {
    log('поле user — невалидный JSON');
    return null;
  }
  if (
    !profile ||
    typeof profile !== 'object' ||
    typeof (profile as { id?: unknown }).id !== 'number' ||
    !Number.isSafeInteger((profile as { id: number }).id) ||
    (profile as { id: number }).id <= 0
  ) {
    log('поле user имеет неверную структуру');
    return null;
  }
  const raw = profile as { id: number; first_name?: string; name?: string; username?: string };
  const user: MaxProfile = {
    id: raw.id,
    name: raw.name ?? raw.first_name ?? 'Пользователь MAX',
    username: raw.username ?? null,
  };
  return { user, authDate: parsed.authDate };
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
