import { Router } from 'express';
import { requireTelegramAuth, requireActiveUser, type AuthedRequest } from '../middleware/auth';
import { getDriverProfile } from '../../services/userService';
import {
  createRide,
  searchRides,
  listRidesByDriver,
  cancelRide,
  getRideWithDriver,
} from '../../services/rideService';
import { config, type City } from '../../config';

export const ridesRouter = Router();

ridesRouter.use(requireTelegramAuth, requireActiveUser);

function isCity(value: unknown): value is City {
  return typeof value === 'string' && (config.cities as readonly string[]).includes(value);
}

/** Поиск активных поездок, опционально по направлению. */
ridesRouter.get('/', (req, res) => {
  const fromCity = isCity(req.query.from) ? req.query.from : undefined;
  const toCity = isCity(req.query.to) ? req.query.to : undefined;
  const rides = searchRides({ fromCity, toCity, onlyAvailable: req.query.onlyAvailable === '1' });
  res.json({ rides });
});

/** Поездки текущего водителя. */
ridesRouter.get('/mine', (req, res) => {
  const { user } = req as AuthedRequest;
  res.json({ rides: listRidesByDriver(user.telegram_id) });
});

/** Публикация новой поездки. Требует зарегистрированного и верифицированного водителя. */
ridesRouter.post('/', (req, res) => {
  const { user } = req as AuthedRequest;
  const driverProfile = getDriverProfile(user.telegram_id);
  if (!driverProfile) {
    res.status(403).json({ error: 'Сначала зарегистрируйтесь как водитель' });
    return;
  }

  const { fromCity, toCity, departureAt, pricePerSeat, seatsTotal, comment } = req.body ?? {};
  if (!isCity(fromCity) || !isCity(toCity) || fromCity === toCity) {
    res.status(400).json({ error: 'Некорректное направление поездки' });
    return;
  }
  const departure = new Date(departureAt);
  if (Number.isNaN(departure.getTime()) || departure.getTime() < Date.now() - 60_000) {
    res.status(400).json({ error: 'Некорректные дата и время отправления' });
    return;
  }
  const price = Number(pricePerSeat);
  const seats = Number(seatsTotal);
  if (!Number.isInteger(price) || price < 0 || price > 100000) {
    res.status(400).json({ error: 'Некорректная цена за место' });
    return;
  }
  if (!Number.isInteger(seats) || seats < 1 || seats > 8) {
    res.status(400).json({ error: 'Количество мест должно быть от 1 до 8' });
    return;
  }

  const ride = createRide({
    driverId: user.telegram_id,
    fromCity,
    toCity,
    departureAt: departure.toISOString(),
    pricePerSeat: price,
    seatsTotal: seats,
    comment: typeof comment === 'string' ? comment.trim().slice(0, 300) : undefined,
  });
  res.status(201).json({ ride });
});

/** Отмена поездки водителем. */
ridesRouter.post('/:id/cancel', (req, res) => {
  const { user } = req as unknown as AuthedRequest;
  const rideId = Number(req.params.id);
  const ok = cancelRide(rideId, user.telegram_id);
  if (!ok) {
    res.status(404).json({ error: 'Поездка не найдена или уже отменена' });
    return;
  }
  res.json({ ok: true });
});

ridesRouter.get('/:id', (req, res) => {
  const ride = getRideWithDriver(Number(req.params.id));
  if (!ride) {
    res.status(404).json({ error: 'Поездка не найдена' });
    return;
  }
  res.json({ ride });
});
