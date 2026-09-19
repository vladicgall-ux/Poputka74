/**
 * Разбор параметров постраничного вывода.
 *
 * Зачем. Списки в админке и поиск поездок отдавались целиком: `SELECT *`
 * без LIMIT. Пока пользователей и поездок мало, это незаметно, но растёт
 * такой запрос линейно и бьёт сразу по трём местам — память процесса,
 * время ответа и объём персональных данных в одном ответе. И всё это
 * доступно по одному HTTP-запросу.
 *
 * limit жёстко ограничен сверху: клиент не должен иметь возможности
 * попросить «все сразу», подставив limit=1000000.
 */

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export interface Page {
  limit: number;
  offset: number;
}

function toPositiveInt(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{1,9}$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * Читает ?limit= и ?offset=. Некорректные значения не считаются ошибкой
 * запроса — берётся значение по умолчанию: это списки для интерфейса, и
 * ронять их 400-й ошибкой из-за кривого параметра смысла нет.
 */
export function parsePage(query: Record<string, unknown>): Page {
  const limitRaw = toPositiveInt(query.limit);
  const offsetRaw = toPositiveInt(query.offset);
  const limit = limitRaw && limitRaw > 0 ? Math.min(limitRaw, MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;
  const offset = offsetRaw ?? 0;
  return { limit, offset };
}
