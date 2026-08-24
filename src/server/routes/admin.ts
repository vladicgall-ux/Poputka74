import { Router, type Request, type Response } from 'express';
import { requireTelegramAuth, type AuthedRequest } from '../middleware/auth';
import { config } from '../../config';
import { listAllUsers, setUserBanned, getUser, getDriverProfile } from '../../services/userService';
import { listAllRides, listRidesByDriver } from '../../services/rideService';
import { listAllBookings, listBookingsByPassenger } from '../../services/bookingService';
import { listAllSupportMessages, createAdminReply } from '../../services/supportService';
import { getAdminStats, getDriverAllTimeStats, getPassengerAllTimeStats } from '../../services/statsService';
import { getDriverRatingSummary } from '../../services/ratingService';
import { notify } from '../../bot/notifier';

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
  res.json({ user, driverProfile, rides, driverStats, rating, bookings, passengerStats });
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
  await notify(userId, `✉️ <b>Ответ поддержки</b>\n\n${message}`);
  res.status(201).json({ message: record });
});

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
