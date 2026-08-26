import { Keyboard, type Bot } from '@maxhub/max-bot-api';
import { realMaxUserId, type UserRecord } from '../services/userService';
import type { ActionButton } from './notifier';

let maxBotInstance: Bot | null = null;

export function setMaxBotInstance(bot: Bot): void {
  maxBotInstance = bot;
}

/**
 * Сообщение со ссылкой (Keyboard.button.link) вместо callback-кнопки —
 * используется, только когда нужно открыть конкретный URL (например,
 * Mini App с параметром вроде ?tab=mine), а не вызвать action в самом боте.
 * Если MAX откроет ссылку не как встроенный Mini App, а как внешний
 * браузер — initData не будет, но приложение уже умеет входить по коду
 * через browserLoginGate, так что это не тупик, а лишний шаг.
 */
export async function notifyMaxWithLink(
  user: UserRecord,
  text: string,
  buttonText: string,
  url: string
): Promise<boolean> {
  if (!maxBotInstance) return false;
  try {
    await maxBotInstance.api.sendMessageToUser(realMaxUserId(user), text, {
      format: 'html',
      attachments: [Keyboard.inlineKeyboard([[Keyboard.button.link(buttonText, url)]])],
    });
    return true;
  } catch {
    return false;
  }
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
