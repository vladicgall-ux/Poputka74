import express from 'express';
import path from 'path';
import { usersRouter } from './routes/users';
import { ridesRouter } from './routes/rides';
import { bookingsRouter } from './routes/bookings';

export function createApp() {
  const app = express();
  app.use(express.json());

  app.use('/api/users', usersRouter);
  app.use('/api/rides', ridesRouter);
  app.use('/api/bookings', bookingsRouter);

  app.use(express.static(path.join(__dirname, '..', '..', 'public')));

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  });

  return app;
}
