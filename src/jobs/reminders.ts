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
import { notify, notifyUser, notifyPhoneReminder, type NotifyButton } from '../bot/notifier';
import { notifyMaxWithLink, notifyMaxPhoneReminder } from '../bot/maxNotifier';
import { getUser, listUsersDueForPhoneReminder, markPhoneReminderSent } from '../services/userService';
import { displayName } from '../utils/displayName';
import { formatDate } from '../utils/dateFormat';

/**
 * Через час после поездки просит пассажира оценить водителя — если бронь
 * подтверждена и оценки ещё нет. Отмечает бронь как «напоминание отправлено»
 * сразу после отправки, чтобы не слать повторно на каждом тике.
 *
 * Кнопка «Оценить поездку» ведёт на ?tab=mine — app.js при загрузке читает
 * этот параметр и сразу открывает «Мои поездки» → «Как пассажир», а не
 * просто стартовый экран поиска. В Telegram это web_app-кнопка (гарантированно
 * открывает именно Mini App с initData). В MAX — обычная ссылка: если MAX
 * откроет её не как встроенный Mini App, а как внешний браузер, initData не
 * будет, но приложение уже умеет входить по коду через browserLoginGate —
 * это лишний шаг, а не тупик, так что кнопку всё равно стоит слать.
 */
export async function sendRatingReminders(): Promise<void> {
  const due = listBookingsDueForRatingReminder();
  for (const b of due) {
    const passenger = getUser(b.passenger_id);
    if (passenger) {
      const text = `🌟 Как прошла поездка ${b.from_city} → ${b.to_city} с водителем ${displayName(b.driver_full_name, b.driver_first_name)}?\nОцените поездку в приложении — это поможет другим пассажирам.`;
      const deepLink = config.webappUrl ? `${config.webappUrl}?tab=mine` : undefined;
      if (passenger.platform === 'telegram') {
        const buttons: NotifyButton[][] | undefined = deepLink
          ? [[{ text: '⭐ Оценить поездку', web_app: { url: deepLink } }]]
          : undefined;
        await notify(passenger.telegram_id, text, buttons);
      } else if (deepLink) {
        await notifyMaxWithLink(passenger, text, '⭐ Оценить поездку', deepLink);
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

/**
 * Раз в час напоминает подтвердить номер телефона тем, кто зарегистрировался
 * (написал боту), но так и не поделился контактом — с той же кнопкой, что
 * была на /start. Продолжается, пока пользователь не подтвердит номер, не
 * будет заблокирован администратором или не перестанет получать сообщения
 * (заблокирует бота — тогда notify просто вернёт false, без ошибки).
 */
export async function sendPhoneVerificationReminders(): Promise<void> {
  const due = listUsersDueForPhoneReminder();
  const text =
    'Напоминаем: чтобы бронировать поездки или публиковать свои, нужно подтвердить номер телефона кнопкой ниже.';
  for (const user of due) {
    if (user.platform === 'telegram') {
      await notifyPhoneReminder(user.telegram_id, text);
    } else {
      await notifyMaxPhoneReminder(user, text);
    }
    markPhoneReminderSent(user.telegram_id);
  }
}
