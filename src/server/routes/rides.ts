import { Router, type Request } from 'express';
import { requireTelegramAuth, requireActiveUser, type AuthedRequest } from '../middleware/auth';
import { writeLimiter } from '../middleware/rateLimit';
import { getDriverProfile } from '../../services/userService';
import {
  createRide,
  searchRides,
  listRidesByDriver,
  cancelRide,
  getRideWithDriver,
} from '../../services/rideService';
import {
  createRideTemplate,
  listTemplatesByDriver,
  deactivateTemplate,
} from '../../services/rideTemplateService';
import { getRidePassengers, BookingError } from '../../services/bookingService';
import { getDriverStats } from '../../services/statsService';
import { config, type City } from '../../config';

export const ridesRouter = Router();

ridesRouter.use(requireTelegramAuth, requireActiveUser);

function isCity(value: unknown): value is City {
  return typeof value === 'string' && (config.cities as readonly string[]).includes(value);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Читает и валидирует ?from=&to= (YYYY-MM-DD) — используется для фильтров по дате. */
function parseRange(req: Request): { from: string; to: string } | undefined {
  const from = req.query.from;
  const to = req.query.to;
  if (typeof from === 'string' && typeof to === 'string' && DATE_RE.test(from) && DATE_RE.test(to)) {
    return { from, to };
  }
  return undefined;
}

/** Поиск активных поездок, опционально по направлению, дате, местам и рейтингу водителя. */
ridesRouter.get('/', (req, res) => {
  const fromCity = isCity(req.query.from) ? req.query.from : undefined;
  const toCity = isCity(req.query.to) ? req.query.to : undefined;
  const date = typeof req.query.date === 'string' && DATE_RE.test(req.query.date) ? req.query.date : undefined;
  const minSeats = Number(req.query.minSeats);
  const minRating = Number(req.query.minRating);
  const sort = req.query.sort === 'price' ? 'price' : 'time';
  const rides = searchRides({
    fromCity,
    toCity,
    date,
    onlyAvailable: req.query.onlyAvailable === '1',
    minSeats: Number.isInteger(minSeats) && minSeats > 0 ? minSeats : undefined,
    minRating: Number.isFinite(minRating) && minRating > 0 ? minRating : undefined,
    sort,
  });
  res.json({ rides });
});

/** Поездки текущего водителя, опционально в диапазоне дат. */
ridesRouter.get('/mine', (req, res) => {
  const { user } = req as AuthedRequest;
  res.json({ rides: listRidesByDriver(user.telegram_id, parseRange(req)) });
});

/** Статистика водителя (число поездок, пассажиров, заработок) за диапазон дат. */
ridesRouter.get('/mine/stats', (req, res) => {
  const { user } = req as AuthedRequest;
  const range = parseRange(req);
  if (!range) {
    res.status(400).json({ error: 'Укажите диапазон дат (from, to)' });
    return;
  }
  res.json({ stats: getDriverStats(user.telegram_id, range.from, range.to) });
});

/** Публикация новой поездки. Требует зарегистрированного и верифицированного водителя. */
ridesRouter.post('/', writeLimiter(15, 10 * 60_000), (req, res) => {
  const { user } = req as AuthedRequest;
  const driverProfile = getDriverProfile(user.telegram_id);
  if (!driverProfile) {
    res.status(403).json({ error: 'Сначала зарегистрируйтесь как водитель' });
    return;
  }

  const { fromCity, toCity, departureAt, pricePerSeat, seatsTotal, comment, meetingPoint, dropoffPoint } =
    req.body ?? {};
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
    meetingPoint: typeof meetingPoint === 'string' ? meetingPoint.trim().slice(0, 200) : undefined,
    dropoffPoint: typeof dropoffPoint === 'string' ? dropoffPoint.trim().slice(0, 200) : undefined,
  });
  res.status(201).json({ ride });
});

/** Шаблоны регулярных поездок текущего водителя. */
ridesRouter.get('/templates/mine', (req, res) => {
  const { user } = req as AuthedRequest;
  res.json({ templates: listTemplatesByDriver(user.telegram_id) });
});

/** Создание шаблона регулярной поездки — реальные rides генерируются периодической задачей. */
ridesRouter.post('/templates', writeLimiter(10, 10 * 60_000), (req, res) => {
  const { user } = req as AuthedRequest;
  const driverProfile = getDriverProfile(user.telegram_id);
  if (!driverProfile) {
    res.status(403).json({ error: 'Сначала зарегистрируйтесь как водитель' });
    return;
  }

  const { fromCity, toCity, departureTime, weekdays, pricePerSeat, seatsTotal, comment, meetingPoint, dropoffPoint } =
    req.body ?? {};
  if (!isCity(fromCity) || !isCity(toCity) || fromCity === toCity) {
    res.status(400).json({ error: 'Некорректное направление поездки' });
    return;
  }
  if (typeof departureTime !== 'string' || !/^\d{2}:\d{2}$/.test(departureTime)) {
    res.status(400).json({ error: 'Укажите время отправления в формате ЧЧ:ММ' });
    return;
  }
  const weekdaysList = Array.isArray(weekdays) ? weekdays.map(Number).filter((n) => n >= 0 && n <= 6) : [];
  if (!weekdaysList.length) {
    res.status(400).json({ error: 'Выберите хотя бы один день недели' });
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

  const template = createRideTemplate({
    driverId: user.telegram_id,
    fromCity,
    toCity,
    departureTime,
    weekdays: weekdaysList,
    pricePerSeat: price,
    seatsTotal: seats,
    comment: typeof comment === 'string' ? comment.trim().slice(0, 300) : undefined,
    meetingPoint: typeof meetingPoint === 'string' ? meetingPoint.trim().slice(0, 200) : undefined,
    dropoffPoint: typeof dropoffPoint === 'string' ? dropoffPoint.trim().slice(0, 200) : undefined,
  });
  res.status(201).json({ template });
});

/** Остановка регулярной поездки — уже созданные rides не трогает, только будущую генерацию. */
ridesRouter.post('/templates/:id/deactivate', (req, res) => {
  const { user } = req as unknown as AuthedRequest;
  const ok = deactivateTemplate(Number(req.params.id), user.telegram_id);
  if (!ok) {
    res.status(404).json({ error: 'Шаблон не найден' });
    return;
  }
  res.json({ ok: true });
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

/** Пассажиры поездки + заработок — видно только водителю этой поездки. */
ridesRouter.get('/:id/passengers', (req, res) => {
  const { user } = req as unknown as AuthedRequest;
  try {
    const result = getRidePassengers(Number(req.params.id), user.telegram_id);
    res.json(result);
  } catch (err) {
    if (err instanceof BookingError) {
      res.status(403).json({ error: err.message });
      return;
    }
    throw err;
  }
});

ridesRouter.get('/:id', (req, res) => {
  const ride = getRideWithDriver(Number(req.params.id));
  if (!ride) {
    res.status(404).json({ error: 'Поездка не найдена' });
    return;
  }
  res.json({ ride });
});
