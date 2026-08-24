"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setMaxBotInstance = setMaxBotInstance;
exports.notifyMax = notifyMax;
const userService_1 = require("../services/userService");
let maxBotInstance = null;
function setMaxBotInstance(bot) {
    maxBotInstance = bot;
}
/** Отправляет пользователю MAX сообщение; молча игнорирует ошибки, аналогично notify() для Telegram. */
async function notifyMax(user, text) {
    if (!maxBotInstance)
        return false;
    try {
        await maxBotInstance.api.sendMessageToUser((0, userService_1.realMaxUserId)(user), text, { format: 'html' });
        return true;
    }
    catch {
        return false;
    }
}
