import type { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Express 4 не умеет ловить ошибки из async-обработчиков: он вызывает
 * функцию и игнорирует возвращённый промис. Если такой обработчик бросит
 * (или упадёт await внутри), промис остаётся отклонённым — это не доходит
 * ни до error-middleware в app.ts, ни до клиента, который просто виснет до
 * таймаута. А Node с версии 15 по умолчанию завершает процесс на
 * необработанном reject — то есть одна ошибка БД в /api/bookings роняла
 * весь процесс целиком, вместе с обоими ботами.
 *
 * Оборачиваем каждый async-роут: промис ловится и ошибка уходит в next(),
 * то есть в тот же обработчик ошибок, что и у синхронных роутов.
 */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
