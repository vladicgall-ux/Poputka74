import { Keyboard, type Bot } from '@maxhub/max-bot-api';
import { realMaxUserId, type UserRecord } from '../services/userService';
import type { ActionButton } from './notifier';

let maxBotInstance: Bot | null = null;

export function setMaxBotInstance(bot: Bot): void {
  maxBotInstance = bot;
}

/** Отправляет пользователю MAX сообщение (при необходимости — с кнопками действий); молча игнорирует ошибки, аналогично notify() для Telegram. */
export async function notifyMax(user: UserRecord, text: string, buttonRows?: ActionButton[][]): Promise<boolean> {
  if (!maxBotInstance) return false;
  try {
    await maxBotInstance.api.sendMessageToUser(realMaxUserId(user), text, {
      format: 'html',
      ...(buttonRows
        ? { attachments: [Keyboard.inlineKeyboard(buttonRows.map((row) => row.map((b) => Keyboard.button.callback(b.text, b.action))))] }
        : {}),
    });
    return true;
  } catch {
    return false;
  }
}
