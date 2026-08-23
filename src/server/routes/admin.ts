import { Router, type Request, type Response } from 'express';
import { requireTelegramAuth, type AuthedRequest } from '../middleware/auth';
import { config } from '../../config';
import { listAllUsers, setUserBanned, getUser } from '../../services/userService';
import { listAllRides } from '../../services/rideService';
import { listAllBookings } from '../../services/bookingService';
import { listAllSupportMessages } from '../../services/supportService';

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

adminRouter.get('/users', (_req, res) => {
  res.json({ users: listAllUsers() });
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
