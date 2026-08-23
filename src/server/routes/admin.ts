import { Router } from 'express';
import { requireTelegramAuth, type AuthedRequest } from '../middleware/auth';
import { config } from '../../config';
import { listAllUsers } from '../../services/userService';
import { listAllRides } from '../../services/rideService';
import { listAllBookings } from '../../services/bookingService';

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
