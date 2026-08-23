import { Router } from 'express';
import { requireTelegramAuth, requireActiveUser, type AuthedRequest } from '../middleware/auth';
import { writeLimiter } from '../middleware/rateLimit';
import { createRating, RatingError } from '../../services/ratingService';

export const ratingsRouter = Router();

ratingsRouter.use(requireTelegramAuth, requireActiveUser);

ratingsRouter.post('/', writeLimiter(20, 10 * 60_000), (req, res) => {
  const { user } = req as AuthedRequest;
  const rideId = Number(req.body?.rideId);
  const rating = Number(req.body?.rating);
  const comment = typeof req.body?.comment === 'string' ? req.body.comment.trim().slice(0, 300) : undefined;

  if (!Number.isInteger(rideId) || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    res.status(400).json({ error: 'Некорректная оценка' });
    return;
  }

  try {
    const record = createRating({ rideId, passengerId: user.telegram_id, rating, comment });
    res.status(201).json({ rating: record });
  } catch (err) {
    if (err instanceof RatingError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
});
