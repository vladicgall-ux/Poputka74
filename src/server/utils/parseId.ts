/**
 * Разбирает числовой ID из параметра маршрута (:id и т.п.). better-sqlite3
 * не падает на NaN/отрицательных значениях в WHERE (просто не находит
 * строку — запрос корректно отвечает 404/400), так что это не защита от
 * краша, а более честный и явный 400 вместо "не найдено" на заведомо
 * некорректный вход вроде /api/rides/abc.
 */
export function parseId(value: string): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * Как parseId(), но разрешает отрицательные значения — telegram_id
 * пользователей MAX хранится в БД со знаком минус (см. комментарий в
 * db.ts про поддержку MAX), поэтому для admin-эндпоинтов по user_id/
 * telegram_id обычный parseId() (только положительные) недопустим.
 */
export function parseSignedId(value: string): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id !== 0 ? id : null;
}
