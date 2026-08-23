"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setBotInstance = setBotInstance;
exports.notify = notify;
const telegraf_1 = require("telegraf");
let botInstance = null;
function setBotInstance(bot) {
    botInstance = bot;
}
/** Отправляет сообщение пользователю; молча игнорирует ошибки (например, если он ни разу не писал боту). */
async function notify(telegramId, text, buttonRows) {
    if (!botInstance)
        return;
    try {
        await botInstance.telegram.sendMessage(telegramId, text, {
            parse_mode: 'HTML',
            ...(buttonRows ? telegraf_1.Markup.inlineKeyboard(buttonRows) : {}),
        });
    }
    catch {
        // пользователь мог заблокировать бота — это не критично
    }
}
