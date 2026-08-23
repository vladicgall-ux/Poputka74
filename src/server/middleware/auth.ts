import type { Request, Response, NextFunction } from 'express';
import { validateInitData } from '../../utils/telegramAuth';
import { upsertUser, getUser, type UserRecord } from '../../services/userService';

export interface AuthedRequest extends Request {
  user: UserRecord;
}

/**
 * Ожидает заголовок X-Telegram-Init-Data с сырой строкой initData,
 * которую фронтенд Mini App получает из window.Telegram.WebApp.initData.
 * Это единственный способ авторизации в API — так исключаются
 * подделанные запросы от имени чужого telegram_id.
 */
export function requireTelegramAuth(req: Request, res: Response, next: NextFunction): void {
  const initData = req.header('X-Telegram-Init-Data') ?? '';
  const validated = validateInitData(initData);
  if (!validated) {
    res.status(401).json({ error: 'Недействительные данные авторизации Telegram' });
    return;
  }
  const user = upsertUser(validated.user);
  (req as AuthedRequest).user = getUser(user.telegram_id)!;
  next();
}
