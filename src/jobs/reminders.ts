import { config } from '../config';
import {
  listBookingsDueForRatingReminder,
  markRatingReminderSent,
  listConfirmedPassengerIds,
} from '../services/bookingService';
import {
  listRidesDueForDepartureReminder,
  markDepartureReminderSent,
} from '../services/rideService';
import { notify, notifyUser, type NotifyButton } from '../bot/notifier';
import { getUser } from '../services/userService';
import { displayName } from '../utils/displayName';
import { formatDate } from '../utils/dateFormat';

/**
 * Через час после поездки просит пассажира оценить водителя — если бронь
 * подтверждена и оценки ещё нет. Отмечает бронь как «напоминание отправлено»
 * сразу после отправки, чтобы не слать повторно на каждом тике.
 *
 * Кнопка «Оценить поездку» открывает Mini App через web_app — это работает
 * только в Telegram (в MAX подтверждённого способа открыть Mini App кнопкой
 * из чата пока нет, а обычная url-кнопка потеряла бы initData). Пассажирам
 * MAX уходит тот же текст без кнопки — приложение у них уже закреплено в чате.
 */
export async function sendRatingReminders(): Promise<void> {
  const due = listBookingsDueForRatingReminder();
  for (const b of due) {
    const passenger = getUser(b.passenger_id);
    if (passenger) {
      const text = `🌟 Как прошла поездка ${b.from_city} → ${b.to_city} с водителем ${displayName(b.driver_full_name, b.driver_first_name)}?\nОцените поездку в приложении — это поможет другим пассажирам.`;
      if (passenger.platform === 'telegram') {
        const buttons: NotifyButton[][] | undefined = config.webappUrl
          ? [[{ text: '⭐ Оценить поездку', web_app: { url: config.webappUrl } }]]
          : undefined;
        await notify(passenger.telegram_id, text, buttons);
      } else {
        await notifyUser(passenger, text);
      }
    }
    markRatingReminderSent(b.id);
  }
}

/**
 * За час до отправления напоминает водителю и всем пассажирам с
 * подтверждённой бронью — чтобы поездка не забылась. Одно напоминание на
 * поездку (флаг на rides), а не на каждого пассажира отдельно.
 */
export async function sendDepartureReminders(): Promise<void> {
  const due = listRidesDueForDepartureReminder();
  for (const ride of due) {
    const route = `${ride.from_city} → ${ride.to_city}`;
    const meetingLine =
      (ride.meeting_point ? `\n📍 Место встречи: ${ride.meeting_point}` : '') +
      (ride.dropoff_point ? `\n🏁 Конечная точка: ${ride.dropoff_point}` : '');

    const driver = getUser(ride.driver_id);
    if (driver) {
      await notifyUser(driver, `⏰ Через час у вас поездка ${route} (${formatDate(ride.departure_at)}).${meetingLine}`);
    }

    for (const passengerId of listConfirmedPassengerIds(ride.ride_id)) {
      const passenger = getUser(passengerId);
      if (passenger) {
        await notifyUser(
          passenger,
          `⏰ Через час ваша поездка ${route} (${formatDate(ride.departure_at)}).${meetingLine}`
        );
      }
    }

    markDepartureReminderSent(ride.ride_id);
  }
}
