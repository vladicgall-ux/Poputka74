import { config } from '../config';
import { listBookingsDueForRatingReminder, markRatingReminderSent } from '../services/bookingService';
import { notify, notifyUser, type NotifyButton } from '../bot/notifier';
import { getUser } from '../services/userService';
import { displayName } from '../utils/displayName';

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
