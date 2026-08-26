/**
 * Без явной timeZone Node форматирует по времени сервера (обычно UTC на
 * хостинге), а не по местному времени Челябинска/Кунашака — из-за этого
 * в уведомлениях время показывалось на 5 часов меньше настоящего.
 */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Yekaterinburg',
  });
}
