import { Router } from 'express';
import { requireTelegramAuth, requireActiveUser, type AuthedRequest } from '../middleware/auth';
import { createBooking, cancelBooking, listBookingsByPassenger, BookingError } from '../../services/bookingService';
import { getRideWithDriver } from '../../services/rideService';
import { notify, type NotifyButton } from '../../bot/notifier';

export const bookingsRouter = Router();

bookingsRouter.use(requireTelegramAuth, requireActiveUser);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

bookingsRouter.get('/mine', (req, res) => {
  const { user } = req as AuthedRequest;
  const { from, to } = req.query;
  const range =
    typeof from === 'string' && typeof to === 'string' && DATE_RE.test(from) && DATE_RE.test(to)
      ? { from, to }
      : undefined;
  res.json({ bookings: listBookingsByPassenger(user.telegram_id, range) });
});

/**
 * Бронирование места. Требует подтверждённый телефон пассажира — защита от
 * фейковых броней. Место резервируется сразу, но бронь остаётся 'pending',
 * пока водитель не подтвердит её кнопкой в чате с ботом.
 */
bookingsRouter.post('/', async (req, res) => {
  const { user } = req as AuthedRequest;
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

    const driverButtons: NotifyButton[][] = [
      [
        { text: '✅ Подтверждаю бронирование', callback_data: `confirm_booking:${booking.id}` },
        { text: '❌ Отклонить', callback_data: `decline_booking:${booking.id}` },
      ],
    ];
    await notify(
      ride.driver_id,
      `🚗 Новая заявка на бронирование!\n${passengerName} хочет забронировать ${seats} мест. на поездку ${ride.from_city} → ${ride.to_city} (${formatDate(ride.departure_at)}).\nНажмите «Подтверждаю», чтобы место закрепилось за пассажиром и вы получили его контакт.`,
      driverButtons
    );
    await notify(
      user.telegram_id,
      `⏳ Заявка отправлена водителю!\n${ride.from_city} → ${ride.to_city}, ${formatDate(ride.departure_at)}\nВодитель: ${ride.driver_first_name}\nЖдём подтверждения — как только водитель подтвердит, вы получите его контакт.`
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
