"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setMaxBotInstance = setMaxBotInstance;
exports.notifyMax = notifyMax;
const max_bot_api_1 = require("@maxhub/max-bot-api");
const userService_1 = require("../services/userService");
let maxBotInstance = null;
function setMaxBotInstance(bot) {
    maxBotInstance = bot;
}
/** Отправляет пользователю MAX сообщение (при необходимости — с кнопками действий); молча игнорирует ошибки, аналогично notify() для Telegram. */
async function notifyMax(user, text, buttonRows) {
    if (!maxBotInstance)
        return false;
    try {
        await maxBotInstance.api.sendMessageToUser((0, userService_1.realMaxUserId)(user), text, {
            format: 'html',
            ...(buttonRows
                ? { attachments: [max_bot_api_1.Keyboard.inlineKeyboard(buttonRows.map((row) => row.map((b) => max_bot_api_1.Keyboard.button.callback(b.text, b.action))))] }
                : {}),
        });
        return true;
    }
    catch {
        return false;
    }
}
