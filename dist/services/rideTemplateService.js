"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRideTemplate = createRideTemplate;
exports.getRideTemplate = getRideTemplate;
exports.listTemplatesByDriver = listTemplatesByDriver;
exports.deactivateTemplate = deactivateTemplate;
exports.generateUpcomingRides = generateUpcomingRides;
const db_1 = require("../db/db");
const rideService_1 = require("./rideService");
function createRideTemplate(input) {
    const info = db_1.db
        .prepare(`INSERT INTO ride_templates (driver_id, from_city, to_city, departure_time, weekdays, price_per_seat, seats_total, comment, meeting_point, dropoff_point)
       VALUES (@driverId, @fromCity, @toCity, @departureTime, @weekdays, @pricePerSeat, @seatsTotal, @comment, @meetingPoint, @dropoffPoint)`)
        .run({
        driverId: input.driverId,
        fromCity: input.fromCity,
        toCity: input.toCity,
        departureTime: input.departureTime,
        weekdays: input.weekdays.join(','),
        pricePerSeat: input.pricePerSeat,
        seatsTotal: input.seatsTotal,
        comment: input.comment ?? null,
        meetingPoint: input.meetingPoint ?? null,
        dropoffPoint: input.dropoffPoint ?? null,
    });
    return getRideTemplate(Number(info.lastInsertRowid));
}
function getRideTemplate(id) {
    return db_1.db.prepare('SELECT * FROM ride_templates WHERE id = ?').get(id);
}
function listTemplatesByDriver(driverId) {
    return db_1.db
        .prepare('SELECT * FROM ride_templates WHERE driver_id = ? AND active = 1 ORDER BY created_at DESC')
        .all(driverId);
}
function deactivateTemplate(id, driverId) {
    const info = db_1.db.prepare(`UPDATE ride_templates SET active = 0 WHERE id = ? AND driver_id = ?`).run(id, driverId);
    return info.changes > 0;
}
/** Местное время Челябинска фиксированное (UTC+5, без перехода на летнее) — как и везде в проекте. */
function chelyabinskLocalToUtcIso(dateStr, timeStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const [hh, mm] = timeStr.split(':').map(Number);
    const utcMs = Date.UTC(y, m - 1, d, hh, mm) - 5 * 60 * 60000;
    return new Date(utcMs).toISOString();
}
function toDateStr(d) {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}
const GENERATION_HORIZON_DAYS = 7;
/**
 * Создаёт конкретные поездки (в rides) на ближайшую неделю по всем активным
 * шаблонам — без дублей, если поездка на эту дату уже была сгенерирована
 * раньше. Вызывается из периодических задач вместе с остальными джобами.
 */
function generateUpcomingRides() {
    const templates = db_1.db.prepare(`SELECT * FROM ride_templates WHERE active = 1`).all();
    if (!templates.length)
        return;
    // Трюк вместо таймзон-библиотеки: сдвигаем эпоху на +5 часов и читаем
    // через getUTC* — тогда эти геттеры возвращают местную дату/время
    // Челябинска, тот же приём, что и '+5 hours' в SQL-запросах по проекту.
    const nowLocal = new Date(Date.now() + 5 * 60 * 60000);
    for (const t of templates) {
        const weekdays = t.weekdays.split(',').map(Number);
        for (let offset = 0; offset < GENERATION_HORIZON_DAYS; offset += 1) {
            const dayLocal = new Date(nowLocal.getTime() + offset * 24 * 60 * 60000);
            if (!weekdays.includes(dayLocal.getUTCDay()))
                continue;
            const departureAt = chelyabinskLocalToUtcIso(toDateStr(dayLocal), t.departure_time);
            if (new Date(departureAt).getTime() <= Date.now())
                continue; // время на сегодня уже прошло
            const exists = db_1.db.prepare(`SELECT 1 FROM rides WHERE template_id = ? AND departure_at = ?`).get(t.id, departureAt);
            if (exists)
                continue;
            (0, rideService_1.createRide)({
                driverId: t.driver_id,
                fromCity: t.from_city,
                toCity: t.to_city,
                departureAt,
                pricePerSeat: t.price_per_seat,
                seatsTotal: t.seats_total,
                comment: t.comment ?? undefined,
                meetingPoint: t.meeting_point ?? undefined,
                dropoffPoint: t.dropoff_point ?? undefined,
                templateId: t.id,
            });
        }
    }
}
