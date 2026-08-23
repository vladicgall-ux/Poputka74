"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setBotInstance = setBotInstance;
exports.notify = notify;
let botInstance = null;
function setBotInstance(bot) {
    botInstance = bot;
}
/** Отправляет сообщение пользователю; молча игнорирует ошибки (например, если он ни разу не писал боту). */
async function notify(telegramId, text) {
    if (!botInstance)
        return;
    try {
        await botInstance.telegram.sendMessage(telegramId, text, { parse_mode: 'HTML' });
    }
    catch {
        // пользователь мог заблокировать бота — это не критично
    }
}
