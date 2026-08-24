import express from 'express';
import path from 'path';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { usersRouter } from './routes/users';
import { ridesRouter } from './routes/rides';
import { bookingsRouter } from './routes/bookings';
import { adminRouter } from './routes/admin';
import { supportRouter } from './routes/support';
import { ratingsRouter } from './routes/ratings';
import { uploadsDir } from './middleware/upload';
import { getBotUsername } from '../bot/notifier';

export function createApp() {
  const app = express();

  // bothost и подобные PaaS обычно ставят приложение за обратный прокси —
  // без этого req.ip будет адресом прокси, и IP-лимитеры/логи будут бесполезны.
  app.set('trust proxy', 1);

  app.use(
    helmet({
      // Mini App должен встраиваться Telegram (в т.ч. в iframe на web.telegram.org) —
      // стандартный X-Frame-Options: SAMEORIGIN это ломает.
      frameguard: false,
      // Строгий CSP без 'unsafe-inline' сломает существующую вёрстку (inline style=...),
      // а тестировать реальный Telegram WebView здесь негде — оставляем выключенным,
      // остальные защитные заголовки helmet (nosniff, HSTS, скрытие X-Powered-By и т.д.)
      // включены и работают.
      contentSecurityPolicy: false,
    })
  );

  // Ограничиваем размер тела запроса — иначе один клиент может прислать
  // гигантский JSON и занять память/CPU процесса на его разборе.
  app.use(express.json({ limit: '100kb' }));

  // Базовая защита от флуда на уровне IP для всего приложения (включая статику).
  app.use(
    rateLimit({
      windowMs: 60_000,
      max: 300,
      standardHeaders: true,
      legacyHeaders: false,
    })
  );

  // Более строгий лимит на API — запросы сюда всегда бьют в БД (better-sqlite3
  // синхронный, так что каждый запрос блокирует event loop на время выполнения).
  app.use(
    '/api',
    rateLimit({
      windowMs: 60_000,
      max: 120,
      standardHeaders: true,
      legacyHeaders: false,
    })
  );

  // Публичный, без авторизации — нужен фронтенду только чтобы собрать
  // ссылку-приглашение t.me/<бот>, никаких приватных данных не отдаёт.
  app.get('/api/config', (_req, res) => {
    res.json({ botUsername: getBotUsername() });
  });

  app.use('/api/users', usersRouter);
  app.use('/api/rides', ridesRouter);
  app.use('/api/bookings', bookingsRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/support', supportRouter);
  app.use('/api/ratings', ratingsRouter);

  app.use('/uploads', express.static(uploadsDir));
  app.use(
    express.static(path.join(__dirname, '..', '..', 'public'), {
      setHeaders: (res, filePath) => {
        // index.html не кэшируем вовсе — иначе Telegram-клиент годами
        // показывает старую версию Mini App внутри своего WebView.
        if (filePath.endsWith('index.html')) {
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        }
      },
    })
  );

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    // body-parser и подобные middleware кладут осмысленный статус (напр. 413
    // при превышении лимита размера тела) в err.status/err.statusCode —
    // уважаем его вместо того, чтобы всегда отвечать 500.
    const withStatus = err as { status?: number; statusCode?: number };
    const status =
      typeof withStatus?.status === 'number'
        ? withStatus.status
        : typeof withStatus?.statusCode === 'number'
          ? withStatus.statusCode
          : 500;
    const message = status === 413 ? 'Слишком большой запрос' : 'Внутренняя ошибка сервера';
    res.status(status >= 400 && status < 600 ? status : 500).json({ error: message });
  });

  return app;
}

