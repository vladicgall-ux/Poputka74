import express from 'express';
import path from 'path';
import { usersRouter } from './routes/users';
import { ridesRouter } from './routes/rides';
import { bookingsRouter } from './routes/bookings';
import { adminRouter } from './routes/admin';
import { supportRouter } from './routes/support';
import { uploadsDir } from './middleware/upload';

export function createApp() {
  const app = express();
  app.use(express.json());

  app.use('/api/users', usersRouter);
  app.use('/api/rides', ridesRouter);
  app.use('/api/bookings', bookingsRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/support', supportRouter);

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
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  });

  return app;
}
