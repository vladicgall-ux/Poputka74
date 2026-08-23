import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { requireTelegramAuth, requireActiveUser, type AuthedRequest } from '../middleware/auth';
import { writeLimiter } from '../middleware/rateLimit';
import { getDriverProfile, upsertDriverProfile, setDriverPhoto } from '../../services/userService';
import { getDriverRatingSummary } from '../../services/ratingService';
import { config } from '../../config';
import { uploadDriverPhoto, uploadsDir } from '../middleware/upload';

export const usersRouter = Router();

usersRouter.use(requireTelegramAuth);

/** Профиль текущего пользователя: данные аккаунта + анкета водителя (если есть). */
usersRouter.get('/me', (req, res) => {
  const { user } = req as AuthedRequest;
  const driverProfile = getDriverProfile(user.telegram_id) ?? null;
  const isAdmin = config.adminIds.includes(user.telegram_id);
  const rating = driverProfile ? getDriverRatingSummary(user.telegram_id) : null;
  res.json({ user, driverProfile, isAdmin, rating });
});

/** Регистрация/обновление анкеты водителя. Требует подтверждённый телефон — защита от фейков. */
usersRouter.post('/me/driver-profile', requireActiveUser, writeLimiter(20, 10 * 60_000), (req, res) => {
  const { user } = req as AuthedRequest;
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

/** Загрузка фото водителя или машины — отдельно от JSON-анкеты, т.к. это multipart-запрос. */
usersRouter.post(
  '/me/photo',
  requireActiveUser,
  writeLimiter(10, 10 * 60_000),
  (req, res, next) => {
    uploadDriverPhoto.single('photo')(req, res, (err: unknown) => {
      if (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Не удалось загрузить фото' });
        return;
      }
      next();
    });
  },
  (req, res) => {
    const { user } = req as AuthedRequest;
    const file = (req as unknown as { file?: Express.Multer.File }).file;
    if (!file) {
      res.status(400).json({ error: 'Файл не получен' });
      return;
    }
    const driverProfile = getDriverProfile(user.telegram_id);
    if (!driverProfile) {
      fs.unlink(file.path, () => {});
      res.status(403).json({ error: 'Сначала сохраните анкету водителя' });
      return;
    }
    if (driverProfile.photo_path) {
      fs.unlink(path.join(uploadsDir, driverProfile.photo_path), () => {});
    }
    setDriverPhoto(user.telegram_id, file.filename);
    res.json({ photoUrl: `/uploads/${file.filename}` });
  }
);
