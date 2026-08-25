"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendRatingReminders = sendRatingReminders;
const config_1 = require("../config");
const bookingService_1 = require("../services/bookingService");
const notifier_1 = require("../bot/notifier");
const userService_1 = require("../services/userService");
const displayName_1 = require("../utils/displayName");
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
async function sendRatingReminders() {
    const due = (0, bookingService_1.listBookingsDueForRatingReminder)();
    for (const b of due) {
        const passenger = (0, userService_1.getUser)(b.passenger_id);
        if (passenger) {
            const text = `🌟 Как прошла поездка ${b.from_city} → ${b.to_city} с водителем ${(0, displayName_1.displayName)(b.driver_full_name, b.driver_first_name)}?\nОцените поездку в приложении — это поможет другим пассажирам.`;
            if (passenger.platform === 'telegram') {
                const buttons = config_1.config.webappUrl
                    ? [[{ text: '⭐ Оценить поездку', web_app: { url: config_1.config.webappUrl } }]]
                    : undefined;
                await (0, notifier_1.notify)(passenger.telegram_id, text, buttons);
            }
            else {
                await (0, notifier_1.notifyUser)(passenger, text);
            }
        }
        (0, bookingService_1.markRatingReminderSent)(b.id);
    }
}
