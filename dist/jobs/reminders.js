"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendRatingReminders = sendRatingReminders;
const config_1 = require("../config");
const bookingService_1 = require("../services/bookingService");
const notifier_1 = require("../bot/notifier");
const displayName_1 = require("../utils/displayName");
/**
 * Через час после поездки просит пассажира оценить водителя — если бронь
 * подтверждена и оценки ещё нет. Отмечает бронь как «напоминание отправлено»
 * сразу после отправки, чтобы не слать повторно на каждом тике.
 */
async function sendRatingReminders() {
    const due = (0, bookingService_1.listBookingsDueForRatingReminder)();
    for (const b of due) {
        const buttons = config_1.config.webappUrl
            ? [[{ text: '⭐ Оценить поездку', web_app: { url: config_1.config.webappUrl } }]]
            : undefined;
        await (0, notifier_1.notify)(b.passenger_id, `🌟 Как прошла поездка ${b.from_city} → ${b.to_city} с водителем ${(0, displayName_1.displayName)(b.driver_full_name, b.driver_first_name)}?\nОцените поездку в приложении — это поможет другим пассажирам.`, buttons);
        (0, bookingService_1.markRatingReminderSent)(b.id);
    }
}
