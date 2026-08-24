import type { Bot } from '@maxhub/max-bot-api';
import { realMaxUserId, type UserRecord } from '../services/userService';

let maxBotInstance: Bot | null = null;

export function setMaxBotInstance(bot: Bot): void {
  maxBotInstance = bot;
}

/** Отправляет пользователю MAX сообщение; молча игнорирует ошибки, аналогично notify() для Telegram. */
export async function notifyMax(user: UserRecord, text: string): Promise<boolean> {
  if (!maxBotInstance) return false;
  try {
    await maxBotInstance.api.sendMessageToUser(realMaxUserId(user), text, { format: 'html' });
    return true;
  } catch {
    return false;
  }
}
