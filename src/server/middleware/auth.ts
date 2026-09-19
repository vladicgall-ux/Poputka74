import type { Request, Response, NextFunction } from 'express';
import { validateInitData } from '../../utils/telegramAuth';
import { validateMaxInitData } from '../../utils/maxAuth';
import { upsertUser, upsertMaxUser, getUser, type UserRecord } from '../../services/userService';
import {
  getSessionUser,
  createWebSession,
  rotateWebSession,
  SESSION_TTL_MS,
} from '../../services/webSessionService';
import { config } from '../../config';

export interface AuthedRequest extends Request {
  user: UserRecord;
}

export const SESSION_COOKIE_NAME = 'web_session';

/**
 * Ставит cookie сессии. HttpOnly — токен недоступен из JS, поэтому его
 * не может прочитать ни сторонний скрипт, ни наш собственный код на
 * фронте (секрет сессии там и не нужен). Secure — только по HTTPS.
 * SameSite=Lax — браузер не пошлёт куку в кросс-сайтовых POST-запросах.
 */
export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: SESSION_TTL_MS,
    path: '/',
  });
}

/**
 * Обмен initData на серверную сессию.
 *
 * initData — это подписанный слепок «кто запустил Mini App», а не сессия:
 * он один и тот же на всё время работы приложения и действует ещё
 * config.initDataMaxAgeSec после выдачи. Поэтому сразу после первой
 * успешной проверки подписи заводим обычную серверную сессию, и дальше
 * запросы живут на ней, а не на повторной отправке initData.
 *
 * Если кука уже есть и принадлежит этому же пользователю — ничего не
 * трогаем. Если она чужая или протухла, выдаём новый токен и гасим
 * старый (ротация): идентификатор, который был у браузера до
 * авторизации, не должен оставаться рабочим после неё.
 */
function issueSessionFor(req: Request, res: Response, userId: number): void {
  const existing = readCookie(req, SESSION_COOKIE_NAME);
  if (existing) {
    const current = getSessionUser(existing);
    if (current && current.telegram_id === userId) return;
    setSessionCookie(res, rotateWebSession(existing, userId));
    return;
  }
  setSessionCookie(res, createWebSession(userId));
}

/** Простой разбор Cookie-заголовка — одна ожидаемая кука, тащить ради
 *  неё зависимость cookie-parser не нужно. */
export function readCookie(req: Request, name: string): string | undefined {
  const header = req.header('Cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return undefined;
}

/**
 * Принимает initData либо из Telegram (заголовок X-Telegram-Init-Data,
 * window.Telegram.WebApp.initData), либо из MAX (заголовок X-Max-Init-Data,
 * window.WebApp.initData через MAX Bridge) — это авторизация внутри Mini
 * App. Вне Mini App (обычный браузер на ПК/телефоне) initData нет вовсе —
 * там используется cookie-сессия, выданная после входа через Telegram
 * Login Widget или код в чате с ботом MAX (см. server/routes/auth.ts).
 * Один из трёх способов должен сработать — иначе запрос отклоняется.
 */
export function requireTelegramAuth(req: Request, res: Response, next: NextFunction): void {
  const telegramInitData = req.header('X-Telegram-Init-Data') ?? '';
  const validatedTelegram = validateInitData(telegramInitData);
  if (validatedTelegram) {
    const user = upsertUser(validatedTelegram.user);
    (req as AuthedRequest).user = getUser(user.telegram_id)!;
    // initData проверена — заводим серверную сессию, дальше запросы
    // пойдут по ней (см. issueSessionFor).
    issueSessionFor(req, res, user.telegram_id);
    next();
    return;
  }

  const maxInitData = req.header('X-Max-Init-Data') ?? '';
  const validatedMax = validateMaxInitData(maxInitData);
  if (validatedMax) {
    const user = upsertMaxUser(validatedMax.user);
    (req as AuthedRequest).user = getUser(user.telegram_id)!;
    issueSessionFor(req, res, user.telegram_id);
    next();
    return;
  }

  const sessionToken = readCookie(req, SESSION_COOKIE_NAME);
  const sessionUser = sessionToken ? getSessionUser(sessionToken) : undefined;
  if (sessionUser) {
    (req as AuthedRequest).user = sessionUser;
    next();
    return;
  }

  res.status(401).json({ error: 'Недействительные данные авторизации' });
}

/**
 * Полностью закрывает доступ к разделу (поиск/бронирование/публикация поездок)
 * забаненным и неверифицированным пользователям — не только запись, но и чтение.
 * Ставится после requireTelegramAuth. GET /api/users/me этой проверкой
 * НЕ прикрыт намеренно — фронтенду нужно узнать статус, чтобы показать экран блокировки.
 */
export function requireActiveUser(req: Request, res: Response, next: NextFunction): void {
  const { user } = req as AuthedRequest;
  if (config.adminIds.includes(user.telegram_id)) {
    // Админы не должны иметь возможность случайно заблокировать себе доступ
    // к собственной панели, отозвав себе телефон или забанив самих себя.
    next();
    return;
  }
  if (user.banned) {
    res.status(403).json({ error: 'Ваш аккаунт заблокирован администратором', banned: true });
    return;
  }
  if (!user.phone_verified) {
    res.status(403).json({ error: 'Подтвердите номер телефона в чате с ботом', phoneRequired: true });
    return;
  }
  if (!user.full_name) {
    res.status(403).json({ error: 'Укажите имя и фамилию', nameRequired: true });
    return;
  }
  next();
}
