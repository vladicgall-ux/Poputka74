import { Router } from 'express';
import { getUser } from '../../services/userService';
import {
  createWebSession,
  deleteWebSession,
  createLoginCode,
  checkLoginCode,
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
 * Вход через браузерную версию сайта (вне Mini App): ни у Telegram (классический
 * Login Widget отключён самим Telegram), ни у MAX нет рабочего публичного
 * login-виджета/OAuth для сторонних сайтов — вместо этого выдаём код,
 * который пользователь присылает боту в чат (Telegram или MAX, любой).
 */
authRouter.post('/login-code/start', writeLimiter(10, 10 * 60_000), (req, res) => {
  const code = createLoginCode();
  res.json({ code, expiresInSec: 600 });
});

/** Фронтенд опрашивает этот эндпоинт, пока пользователь не пришлёт код боту. */
authRouter.get('/login-code/status', (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const userId = code ? checkLoginCode(code) : null;
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
