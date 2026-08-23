import type { Telegraf } from 'telegraf';

let botInstance: Telegraf | null = null;

export function setBotInstance(bot: Telegraf): void {
  botInstance = bot;
}

/** Отправляет сообщение пользователю; молча игнорирует ошибки (например, если он ни разу не писал боту). */
export async function notify(telegramId: number, text: string): Promise<void> {
  if (!botInstance) return;
  try {
    await botInstance.telegram.sendMessage(telegramId, text, { parse_mode: 'HTML' });
  } catch {
    // пользователь мог заблокировать бота — это не критично
  }
}
