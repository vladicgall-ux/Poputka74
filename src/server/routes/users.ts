import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { requireTelegramAuth, requireActiveUser, type AuthedRequest } from '../middleware/auth';
import { writeLimiter } from '../middleware/rateLimit';
import { getDriverProfile, upsertDriverProfile, setDriverPhoto, setFullName, getUser } from '../../services/userService';
import { getDriverRatingSummary, getPassengerRatingSummary } from '../../services/ratingService';
import { config } from '../../config';
import { uploadDriverPhoto, uploadsDir, isValidImageFile, processUploadedImage } from '../middleware/upload';

export const usersRouter = Router();

usersRouter.use(requireTelegramAuth);

/** Профиль текущего пользователя: данные аккаунта + анкета водителя (если есть). */
usersRouter.get('/me', (req, res) => {
  const { user } = req as AuthedRequest;
  const driverProfile = getDriverProfile(user.telegram_id) ?? null;
  const isAdmin = config.adminIds.includes(user.telegram_id);
  const rating = driverProfile ? getDriverRatingSummary(user.telegram_id) : null;
  const passengerRating = getPassengerRatingSummary(user.telegram_id);
  res.json({ user, driverProfile, isAdmin, rating, passengerRating });
});

/**
 * Сохраняет настоящее имя и фамилию — не через requireActiveUser, потому что
 * именно отсутствие full_name и есть та проверка, которую этот запрос должен
 * снять (иначе получился бы замкнутый круг). Телефон всё равно обязателен —
 * имя вводят уже после подтверждения номера.
 */
usersRouter.post('/me/name', writeLimiter(10, 10 * 60_000), (req, res) => {
  const { user } = req as AuthedRequest;
  if (user.banned) {
    res.status(403).json({ error: 'Аккаунт заблокирован' });
    return;
  }
  if (!user.phone_verified) {
    res.status(403).json({ error: 'Сначала подтвердите номер телефона в чате с ботом' });
    return;
  }
  const fullName = typeof req.body?.fullName === 'string' ? req.body.fullName.trim().replace(/\s+/g, ' ') : '';
  if (fullName.length < 3 || fullName.length > 100 || !fullName.includes(' ')) {
    res.status(400).json({ error: 'Укажите имя и фамилию через пробел' });
    return;
  }
  setFullName(user.telegram_id, fullName);
  res.json({ user: getUser(user.telegram_id) });
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
  async (req, res) => {
    const { user } = req as AuthedRequest;
    const file = (req as unknown as { file?: Express.Multer.File }).file;
    if (!file) {
      res.status(400).json({ error: 'Файл не получен' });
      return;
    }
    // Файл только что сохранён multer на диск — если запрос отклонён
    // на любом шаге ниже (плохой файл, нет анкеты, неожиданная ошибка),
    // он должен быть удалён, а не оставаться orphan-файлом в uploads.
    let keepFile = false;
    try {
      if (!isValidImageFile(file.path)) {
        res.status(400).json({ error: 'Файл повреждён или не является изображением' });
        return;
      }
      // Декодирует, проверяет реальные размеры (защита от image bomb) и
      // перекодирует файл — см. upload.ts. Делает лишним отдельный вызов
      // isValidImageFile() выше по сути, но тот дешёвый и быстро отсеивает
      // явный мусор ещё до запуска sharp.
      if (!(await processUploadedImage(file.path, file.mimetype))) {
        res.status(400).json({ error: 'Не удалось обработать изображение — попробуйте другой файл' });
        return;
      }
      const driverProfile = getDriverProfile(user.telegram_id);
      if (!driverProfile) {
        res.status(403).json({ error: 'Сначала сохраните анкету водителя' });
        return;
      }
      if (driverProfile.photo_path) {
        fs.unlink(path.join(uploadsDir, path.basename(driverProfile.photo_path)), () => {});
      }
      setDriverPhoto(user.telegram_id, file.filename);
      keepFile = true;
      res.json({ photoUrl: `/uploads/${file.filename}` });
    } finally {
      if (!keepFile) fs.unlink(file.path, () => {});
    }
  }
);
