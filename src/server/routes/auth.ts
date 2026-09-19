import { Router } from 'express';
import { getUser } from '../../services/userService';
import {
  createWebSession,
  deleteWebSession,
  deleteAllWebSessionsForUser,
  createLoginCode,
  checkLoginCode,
} from '../../services/webSessionService';
import { writeLimiter } from '../middleware/rateLimit';
import { readCookie, requireTelegramAuth, SESSION_COOKIE_NAME, type AuthedRequest } from '../middleware/auth';

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
  const { code, pollToken } = createLoginCode();
  res.json({ code, pollToken, expiresInSec: 600 });
});

/**
 * Фронтенд опрашивает этот эндпоинт, пока пользователь не пришлёт код боту.
 * Лимитер — защита от перебора: без него код всего в 6 цифр можно было бы
 * перебрать полностью за разумное время. pollToken (см. webSessionService)
 * закрывает саму возможность перебора по коду, лимитер — на всякий случай,
 * второй эшелон защиты.
 */
authRouter.post('/login-code/status', writeLimiter(240, 10 * 60_000), (req, res) => {
  // POST, а не GET, и с проверкой источника запроса. Этот эндпоинт не
  // просто читает состояние: он гасит код (used_at), заводит сессию и
  // ставит cookie. Пока это был GET с параметрами в строке запроса, на
  // него можно было завести жертву обычной ссылкой — и её браузер получал
  // cookie сессии ЧУЖОГО аккаунта (атакующий заранее подтверждал свой код
  // со своего аккаунта). Дальше жертва в полной уверенности, что она у
  // себя, вводила своё настоящее имя, бронировала поездки и писала в
  // поддержку — всё это попадало в аккаунт атакующего.
  //
  // SameSite=Lax тут не спасал: он ограничивает ОТПРАВКУ cookie, а здесь
  // cookie именно устанавливается. Sec-Fetch-Site шлют все актуальные
  // браузеры; если заголовка нет вовсе (совсем старый клиент), не
  // блокируем — POST + отсутствие CORS уже отсекают основной сценарий.
  const site = req.header('Sec-Fetch-Site');
  if (site && site !== 'same-origin' && site !== 'none') {
    res.status(403).json({ error: 'Запрос отклонён: вход должен начинаться на этом же сайте' });
    return;
  }
  const code = typeof req.body?.code === 'string' ? req.body.code : '';
  const pollToken = typeof req.body?.pollToken === 'string' ? req.body.pollToken : '';
  const userId = code && pollToken ? checkLoginCode(code, pollToken) : null;
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

/**
 * «Выйти со всех устройств» — обрывает все веб-сессии пользователя (все
 * браузеры, где он входил по коду в чате с ботом), не только текущую.
 * Работает и из Mini App (initData), и из браузерной сессии (cookie) —
 * requireTelegramAuth принимает оба способа и уже определяет user.
 */
authRouter.post('/logout-all', requireTelegramAuth, (req, res) => {
  const { user } = req as AuthedRequest;
  deleteAllWebSessionsForUser(user.telegram_id);
  res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});
