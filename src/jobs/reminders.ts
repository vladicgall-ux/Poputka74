import { config } from '../config';
import { listBookingsDueForRatingReminder, markRatingReminderSent } from '../services/bookingService';
import { notify, type NotifyButton } from '../bot/notifier';
import { displayName } from '../utils/displayName';

/**
 * Через час после поездки просит пассажира оценить водителя — если бронь
 * подтверждена и оценки ещё нет. Отмечает бронь как «напоминание отправлено»
 * сразу после отправки, чтобы не слать повторно на каждом тике.
 */
export async function sendRatingReminders(): Promise<void> {
  const due = listBookingsDueForRatingReminder();
  for (const b of due) {
    const buttons: NotifyButton[][] | undefined = config.webappUrl
      ? [[{ text: '⭐ Оценить поездку', web_app: { url: config.webappUrl } }]]
      : undefined;
    await notify(
      b.passenger_id,
      `🌟 Как прошла поездка ${b.from_city} → ${b.to_city} с водителем ${displayName(b.driver_full_name, b.driver_first_name)}?\nОцените поездку в приложении — это поможет другим пассажирам.`,
      buttons
    );
    markRatingReminderSent(b.id);
  }
}
