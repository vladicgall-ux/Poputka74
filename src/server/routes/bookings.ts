import { Router } from 'express';
import { requireTelegramAuth, type AuthedRequest } from '../middleware/auth';
import { createBooking, cancelBooking, listBookingsByPassenger, BookingError } from '../../services/bookingService';
import { getRideWithDriver } from '../../services/rideService';
import { notify } from '../../bot/notifier';

export const bookingsRouter = Router();

bookingsRouter.use(requireTelegramAuth);

bookingsRouter.get('/mine', (req, res) => {
  const { user } = req as AuthedRequest;
  res.json({ bookings: listBookingsByPassenger(user.telegram_id) });
});

/** Бронирование мест. Требует подтверждённый телефон пассажира — защита от фейковых броней. */
bookingsRouter.post('/', async (req, res) => {
  const { user } = req as AuthedRequest;
  if (!user.phone_verified) {
    res.status(403).json({ error: 'Сначала подтвердите номер телефона через бота' });
    return;
  }
  const rideId = Number(req.body?.rideId);
  const seats = Number(req.body?.seats ?? 1);
  if (!Number.isInteger(rideId) || !Number.isInteger(seats) || seats < 1 || seats > 8) {
    res.status(400).json({ error: 'Некорректный запрос на бронирование' });
    return;
  }

  try {
    const booking = createBooking({ rideId, passengerId: user.telegram_id, seats });
    const ride = getRideWithDriver(rideId)!;

    const passengerName = [user.first_name, user.username ? `@${user.username}` : null]
      .filter(Boolean)
      .join(' ');
    await notify(
      ride.driver_id,
      `🚗 Новое бронирование!\n${passengerName} забронировал(а) ${seats} мест. на поездку ${ride.from_city} → ${ride.to_city} (${formatDate(ride.departure_at)}).\nСвяжитесь для подтверждения: ${user.phone ?? 'номер скрыт'}`
    );
    await notify(
      user.telegram_id,
      `✅ Бронирование подтверждено!\n${ride.from_city} → ${ride.to_city}, ${formatDate(ride.departure_at)}\nВодитель: ${ride.driver_first_name}, ${ride.car_model} (${ride.car_plate})\nСумма: ${ride.price_per_seat * seats} ₽`
    );

    res.status(201).json({ booking });
  } catch (err) {
    if (err instanceof BookingError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
});

bookingsRouter.post('/:id/cancel', async (req, res) => {
  const { user } = req as unknown as AuthedRequest;
  try {
    const booking = cancelBooking(Number(req.params.id), user.telegram_id);
    const ride = getRideWithDriver(booking.ride_id);
    if (ride) {
      await notify(
        ride.driver_id,
        `❌ Пассажир отменил бронирование на поездку ${ride.from_city} → ${ride.to_city} (${formatDate(ride.departure_at)}). Освободилось ${booking.seats_booked} мест.`
      );
    }
    res.json({ booking });
  } catch (err) {
    if (err instanceof BookingError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
});

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
