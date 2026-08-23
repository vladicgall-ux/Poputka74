import { Router } from 'express';
import { requireTelegramAuth, type AuthedRequest } from '../middleware/auth';
import { getDriverProfile, upsertDriverProfile } from '../../services/userService';

export const usersRouter = Router();

usersRouter.use(requireTelegramAuth);

/** Профиль текущего пользователя: данные аккаунта + анкета водителя (если есть). */
usersRouter.get('/me', (req, res) => {
  const { user } = req as AuthedRequest;
  const driverProfile = getDriverProfile(user.telegram_id) ?? null;
  res.json({ user, driverProfile });
});

/** Регистрация/обновление анкеты водителя. Требует подтверждённый телефон — защита от фейков. */
usersRouter.post('/me/driver-profile', (req, res) => {
  const { user } = req as AuthedRequest;
  if (!user.phone_verified) {
    res.status(403).json({ error: 'Сначала подтвердите номер телефона через бота' });
    return;
  }
  const { car_model, car_color, car_plate, experience } = req.body ?? {};
  if (!car_model || typeof car_model !== 'string' || !car_plate || typeof car_plate !== 'string') {
    res.status(400).json({ error: 'Укажите модель и госномер автомобиля' });
    return;
  }
  const profile = upsertDriverProfile(user.telegram_id, {
    car_model: car_model.trim().slice(0, 100),
    car_color: typeof car_color === 'string' ? car_color.trim().slice(0, 40) : undefined,
    car_plate: car_plate.trim().slice(0, 20),
    experience: typeof experience === 'string' ? experience.trim().slice(0, 300) : undefined,
  });
  res.json({ driverProfile: profile });
});
