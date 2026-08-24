import type { Telegraf } from 'telegraf';
import { Markup } from 'telegraf';
import { config } from '../config';

let botInstance: Telegraf | null = null;

export function setBotInstance(bot: Telegraf): void {
  botInstance = bot;
}

export type NotifyButton =
  | { text: string; callback_data: string }
  | { text: string; url: string }
  // Обычная url-кнопка открывает страницу в обычном браузере Telegram —
  // initData там пустой, и наша авторизация не пройдёт. Кнопка с web_app
  // открывает именно Mini App, с рабочим initData.
  | { text: string; web_app: { url: string } };

/** Отправляет сообщение пользователю; молча игнорирует ошибки (например, если он ни разу не писал боту). */
export async function notify(
  telegramId: number,
  text: string,
  buttonRows?: NotifyButton[][]
): Promise<void> {
  if (!botInstance) return;
  try {
    await botInstance.telegram.sendMessage(telegramId, text, {
      parse_mode: 'HTML',
      ...(buttonRows ? Markup.inlineKeyboard(buttonRows) : {}),
    });
  } catch {
    // пользователь мог заблокировать бота — это не критично
  }
}

/** Рассылает сообщение всем администраторам из ADMIN_IDS (например, обращение в поддержку). */
export async function notifyAdmins(text: string, buttonRows?: NotifyButton[][]): Promise<void> {
  await Promise.all(config.adminIds.map((id) => notify(id, text, buttonRows)));
}
