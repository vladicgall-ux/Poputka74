import { Router } from 'express';
import { validateLoginWidgetData } from '../../utils/telegramLoginWidget';
import { upsertUser, getUser } from '../../services/userService';
import {
  createWebSession,
  deleteWebSession,
  createMaxLoginCode,
  checkMaxLoginCode,
} from '../../services/webSessionService';
import { writeLimiter } from '../middleware/rateLimit';
import { readCookie, SESSION_COOKIE_NAME } from '../middleware/auth';

export const authRouter = Router();

const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60_000; // держим в шаге с TTL сессии в webSessionService

function setSessionCookie(res: import('express').Response, token: string) {
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE_MS,
    path: '/',
  });
}

/**
 * Вход через браузерную версию сайта (вне Mini App) по официальному
 * Telegram Login Widget: https://core.telegram.org/widgets/login
 * Фронтенд отдаёт сюда объект, который виджет передал в data-onauth.
 */
authRouter.post('/telegram-widget', writeLimiter(20, 10 * 60_000), (req, res) => {
  const body = req.body ?? {};
  const stringified: Record<string, string> = {};
  for (const key of ['id', 'first_name', 'last_name', 'username', 'photo_url', 'auth_date', 'hash']) {
    if (body[key] !== undefined && body[key] !== null) {
      stringified[key] = String(body[key]);
    }
  }

  const profile = validateLoginWidgetData(stringified);
  if (!profile) {
    res.status(401).json({ error: 'Не удалось подтвердить вход через Telegram' });
    return;
  }

  const user = upsertUser(profile);
  const token = createWebSession(user.telegram_id);
  setSessionCookie(res, token);
  res.json({ user: getUser(user.telegram_id) });
});

/** Начало входа через MAX: выдаём код, который пользователь пришлёт боту в чат. */
authRouter.post('/max-code/start', writeLimiter(10, 10 * 60_000), (req, res) => {
  const code = createMaxLoginCode();
  res.json({ code, expiresInSec: 600 });
});

/** Фронтенд опрашивает этот эндпоинт, пока пользователь не пришлёт код боту в MAX. */
authRouter.get('/max-code/status', (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const userId = code ? checkMaxLoginCode(code) : null;
  if (!userId) {
    res.json({ ok: false });
    return;
  }
  const token = createWebSession(userId);
  setSessionCookie(res, token);
  res.json({ ok: true, user: getUser(userId) });
});

authRouter.post('/logout', (req, res) => {
  const token = readCookie(req, SESSION_COOKIE_NAME);
  if (token) deleteWebSession(token);
  res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});
