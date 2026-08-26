import { Router, type Request, type Response } from 'express';
import fs from 'fs';
import { requireTelegramAuth, type AuthedRequest } from '../middleware/auth';
import { writeLimiter } from '../middleware/rateLimit';
import { uploadBroadcastPhoto } from '../middleware/upload';
import { config } from '../../config';
import { listAllUsers, listActiveUserIds, setUserBanned, getUser, getDriverProfile } from '../../services/userService';
import { listAllRides, listRidesByDriver, countCancelledRidesByDriver } from '../../services/rideService';
import { listAllBookings, listBookingsByPassenger, countCancelledBookingsByPassenger } from '../../services/bookingService';
import { listAllSupportMessages, createAdminReply } from '../../services/supportService';
import { getAdminStats, getDriverAllTimeStats, getPassengerAllTimeStats } from '../../services/statsService';
import { getDriverRatingSummary, getPassengerRatingSummary } from '../../services/ratingService';
import { notifyPhoto, notifyUser } from '../../bot/notifier';

export const adminRouter = Router();

adminRouter.use(requireTelegramAuth);

adminRouter.use((req, res, next) => {
  const { user } = req as AuthedRequest;
  if (!config.adminIds.includes(user.telegram_id)) {
    res.status(403).json({ error: 'Доступ только для администраторов' });
    return;
  }
  next();
});

adminRouter.get('/stats', (_req, res) => {
  res.json({ stats: getAdminStats() });
});

adminRouter.get('/users', (_req, res) => {
  res.json({ users: listAllUsers() });
});

/** Подробная карточка пользователя для админки: поездки, брони, статистика за всё время. */
adminRouter.get('/users/:id', (req, res) => {
  const telegramId = Number(req.params.id);
  const user = getUser(telegramId);
  if (!user) {
    res.status(404).json({ error: 'Пользователь не найден' });
    return;
  }
  const driverProfile = getDriverProfile(telegramId) ?? null;
  const rides = driverProfile ? listRidesByDriver(telegramId) : [];
  const driverStats = driverProfile ? getDriverAllTimeStats(telegramId) : null;
  const rating = driverProfile ? getDriverRatingSummary(telegramId) : null;
  const bookings = listBookingsByPassenger(telegramId);
  const passengerStats = getPassengerAllTimeStats(telegramId);
  const passengerRating = getPassengerRatingSummary(telegramId);
  // Сигнал для модерации: сколько раз пользователь сам отменял брони/поездки.
  const cancelledBookingsCount = countCancelledBookingsByPassenger(telegramId);
  const cancelledRidesCount = driverProfile ? countCancelledRidesByDriver(telegramId) : 0;
  res.json({
    user,
    driverProfile,
    rides,
    driverStats,
    rating,
    bookings,
    passengerStats,
    passengerRating,
    cancelledBookingsCount,
    cancelledRidesCount,
  });
});

adminRouter.get('/rides', (_req, res) => {
  res.json({ rides: listAllRides() });
});

adminRouter.get('/bookings', (_req, res) => {
  res.json({ bookings: listAllBookings() });
});

adminRouter.get('/support', (_req, res) => {
  res.json({ messages: listAllSupportMessages() });
});

/** Ответ администратора пользователю — уходит ему сообщением от бота. */
adminRouter.post('/support/:userId/reply', async (req, res) => {
  const userId = Number(req.params.userId);
  const message = typeof req.body?.message === 'string' ? req.body.message.trim().slice(0, 1000) : '';
  if (!message) {
    res.status(400).json({ error: 'Введите текст ответа' });
    return;
  }
  const target = getUser(userId);
  if (!target) {
    res.status(404).json({ error: 'Пользователь не найден' });
    return;
  }
  const record = createAdminReply(userId, message);
  await notifyUser(target, `✉️ <b>Ответ поддержки</b>\n\n${message}`);
  res.status(201).json({ message: record });
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Массовая рассылка всем незаблокированным пользователям от имени бота
 * (не от личного аккаунта админа). Текст и/или фото — нужно хотя бы одно.
 * Шлём последовательно с небольшой паузой, чтобы не упереться в лимит
 * Telegram (~30 сообщений/сек на бота).
 */
adminRouter.post(
  '/broadcast',
  writeLimiter(5, 60 * 60_000),
  (req, res, next) => {
    uploadBroadcastPhoto.single('photo')(req, res, (err: unknown) => {
      if (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Не удалось загрузить фото' });
        return;
      }
      next();
    });
  },
  async (req, res) => {
    const message = typeof req.body?.message === 'string' ? req.body.message.trim().slice(0, 1000) : '';
    const file = (req as unknown as { file?: Express.Multer.File }).file;
    // multipart/form-data — значения всегда строки, не булевы.
    const pin = req.body?.pin === 'true' || req.body?.pin === '1';

    if (!message && !file) {
      res.status(400).json({ error: 'Добавьте текст или фото' });
      return;
    }

    const recipients = listActiveUserIds();
    let sent = 0;
    for (const telegramId of recipients) {
      const recipient = getUser(telegramId);
      if (!recipient) continue;
      // Фото умеем слать только через Telegram — у пользователей MAX пока
      // нет notifyPhoto для этой платформы, поэтому им уходит хотя бы текст,
      // чтобы рассылка не пропадала для них совсем.
      const ok =
        file && recipient.platform === 'telegram'
          ? await notifyPhoto(telegramId, file.path, message, pin)
          : await notifyUser(recipient, message || '📷 Новое объявление от Поехали 74', undefined, pin);
      if (ok) sent += 1;
      await sleep(40);
    }

    if (file) {
      fs.unlink(file.path, () => {});
    }

    res.json({ sent, total: recipients.length });
  }
);

function setBan(banned: boolean) {
  return (req: Request, res: Response) => {
    const telegramId = Number(req.params.id);
    if (config.adminIds.includes(telegramId)) {
      res.status(400).json({ error: 'Нельзя заблокировать администратора' });
      return;
    }
    const target = getUser(telegramId);
    if (!target) {
      res.status(404).json({ error: 'Пользователь не найден' });
      return;
    }
    setUserBanned(telegramId, banned);
    res.json({ user: getUser(telegramId) });
  };
}

adminRouter.post('/users/:id/ban', setBan(true));
adminRouter.post('/users/:id/unban', setBan(false));
