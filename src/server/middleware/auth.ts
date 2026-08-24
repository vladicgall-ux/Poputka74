import type { Request, Response, NextFunction } from 'express';
import { validateInitData } from '../../utils/telegramAuth';
import { upsertUser, getUser, type UserRecord } from '../../services/userService';
import { config } from '../../config';

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
