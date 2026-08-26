"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendRatingReminders = sendRatingReminders;
exports.sendDepartureReminders = sendDepartureReminders;
const config_1 = require("../config");
const bookingService_1 = require("../services/bookingService");
const rideService_1 = require("../services/rideService");
const notifier_1 = require("../bot/notifier");
const userService_1 = require("../services/userService");
const displayName_1 = require("../utils/displayName");
const dateFormat_1 = require("../utils/dateFormat");
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
/**
 * За час до отправления напоминает водителю и всем пассажирам с
 * подтверждённой бронью — чтобы поездка не забылась. Одно напоминание на
 * поездку (флаг на rides), а не на каждого пассажира отдельно.
 */
async function sendDepartureReminders() {
    const due = (0, rideService_1.listRidesDueForDepartureReminder)();
    for (const ride of due) {
        const route = `${ride.from_city} → ${ride.to_city}`;
        const meetingLine = (ride.meeting_point ? `\n📍 Место встречи: ${ride.meeting_point}` : '') +
            (ride.dropoff_point ? `\n🏁 Конечная точка: ${ride.dropoff_point}` : '');
        const driver = (0, userService_1.getUser)(ride.driver_id);
        if (driver) {
            await (0, notifier_1.notifyUser)(driver, `⏰ Через час у вас поездка ${route} (${(0, dateFormat_1.formatDate)(ride.departure_at)}).${meetingLine}`);
        }
        for (const passengerId of (0, bookingService_1.listConfirmedPassengerIds)(ride.ride_id)) {
            const passenger = (0, userService_1.getUser)(passengerId);
            if (passenger) {
                await (0, notifier_1.notifyUser)(passenger, `⏰ Через час ваша поездка ${route} (${(0, dateFormat_1.formatDate)(ride.departure_at)}).${meetingLine}`);
            }
        }
        (0, rideService_1.markDepartureReminderSent)(ride.ride_id);
    }
}
