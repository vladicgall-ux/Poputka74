/**
 * Разрешённые переходы статусов — в одном месте и явно.
 *
 * Зачем. Переходы раньше делались по схеме «прочитали статус, проверили
 * в JS, записали новый». У такой схемы две беды:
 *
 * 1. Между чтением и записью состояние может измениться. Внутри одного
 *    процесса better-sqlite3 синхронный и этого не случится, но защита,
 *    которая держится на однопоточности рантайма, перестаёт работать
 *    ровно в тот день, когда приложение запустят вторым инстансом.
 * 2. Список допустимых переходов оказывался размазан по условиям в
 *    разных функциях, и проверить его целиком было негде.
 *
 * Поэтому каждый переход выполняется одним условным UPDATE вида
 * `WHERE id = ? AND status IN (<разрешённые исходные>)`, а результат
 * определяется по changes > 0. СУБД сама решает конфликт: при гонке
 * ровно один UPDATE изменит строку, остальные увидят changes = 0.
 * Таблицы ниже — источник правды о том, что в этот WHERE попадает.
 */

export type BookingStatus = 'pending' | 'confirmed' | 'cancelled';
export type RideStatus = 'active' | 'cancelled' | 'completed';

/**
 * Брони. Кто инициирует переход:
 *  - pending -> confirmed: водитель поездки подтверждает заявку.
 *  - pending -> cancelled: водитель отклоняет, либо пассажир отзывает
 *    заявку, либо поездка отменена/просрочена (фоновая задача).
 *  - confirmed -> cancelled: пассажир отменяет подтверждённую бронь
 *    (до отправления) либо водитель отменяет всю поездку.
 * Обратных переходов нет: отменённая бронь не оживает, подтверждённая
 * не возвращается в pending. Завершение брони отдельным статусом не
 * моделируется — состоявшейся считается подтверждённая бронь на
 * прошедшую поездку.
 */
export const BOOKING_TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['cancelled'],
  cancelled: [],
};

/**
 * Поездки.
 *  - active -> cancelled: водитель отменил вручную, либо время вышло и
 *    подтверждённых броней не было (фоновая задача).
 *  - active -> completed: время вышло и была хотя бы одна подтверждённая
 *    бронь (фоновая задача).
 * cancelled и completed — конечные: отменённая поездка не становится
 * активной снова, выполненная не отменяется задним числом.
 */
export const RIDE_TRANSITIONS: Record<RideStatus, readonly RideStatus[]> = {
  active: ['cancelled', 'completed'],
  cancelled: [],
  completed: [],
};

/** Из каких статусов разрешено прийти в целевой — то, что идёт в WHERE. */
export function bookingSourcesFor(target: BookingStatus): BookingStatus[] {
  return (Object.keys(BOOKING_TRANSITIONS) as BookingStatus[]).filter((from) =>
    BOOKING_TRANSITIONS[from].includes(target)
  );
}

export function rideSourcesFor(target: RideStatus): RideStatus[] {
  return (Object.keys(RIDE_TRANSITIONS) as RideStatus[]).filter((from) =>
    RIDE_TRANSITIONS[from].includes(target)
  );
}

export function isBookingTransitionAllowed(from: BookingStatus, to: BookingStatus): boolean {
  return BOOKING_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isRideTransitionAllowed(from: RideStatus, to: RideStatus): boolean {
  return RIDE_TRANSITIONS[from]?.includes(to) ?? false;
}
