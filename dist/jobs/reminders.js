"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendRatingReminders = sendRatingReminders;
exports.sendDepartureReminders = sendDepartureReminders;
const config_1 = require("../config");
const bookingService_1 = require("../services/bookingService");
const rideService_1 = require("../services/rideService");
const notifier_1 = require("../bot/notifier");
const maxNotifier_1 = require("../bot/maxNotifier");
const userService_1 = require("../services/userService");
const displayName_1 = require("../utils/displayName");
const dateFormat_1 = require("../utils/dateFormat");
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
async function sendRatingReminders() {
    const due = (0, bookingService_1.listBookingsDueForRatingReminder)();
    for (const b of due) {
        const passenger = (0, userService_1.getUser)(b.passenger_id);
        if (passenger) {
            const text = `🌟 Как прошла поездка ${b.from_city} → ${b.to_city} с водителем ${(0, displayName_1.displayName)(b.driver_full_name, b.driver_first_name)}?\nОцените поездку в приложении — это поможет другим пассажирам.`;
            const deepLink = config_1.config.webappUrl ? `${config_1.config.webappUrl}?tab=mine` : undefined;
            if (passenger.platform === 'telegram') {
                const buttons = deepLink
                    ? [[{ text: '⭐ Оценить поездку', web_app: { url: deepLink } }]]
                    : undefined;
                await (0, notifier_1.notify)(passenger.telegram_id, text, buttons);
            }
            else if (deepLink) {
                await (0, maxNotifier_1.notifyMaxWithLink)(passenger, text, '⭐ Оценить поездку', deepLink);
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
