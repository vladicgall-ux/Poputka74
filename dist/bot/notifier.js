"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setBotInstance = setBotInstance;
exports.notify = notify;
exports.notifyPhoto = notifyPhoto;
exports.notifyAdmins = notifyAdmins;
const telegraf_1 = require("telegraf");
const config_1 = require("../config");
let botInstance = null;
function setBotInstance(bot) {
    botInstance = bot;
}
/** Отправляет сообщение пользователю; молча игнорирует ошибки (например, если он ни разу не писал боту). */
async function notify(telegramId, text, buttonRows) {
    if (!botInstance)
        return false;
    try {
        await botInstance.telegram.sendMessage(telegramId, text, {
            parse_mode: 'HTML',
            ...(buttonRows ? telegraf_1.Markup.inlineKeyboard(buttonRows) : {}),
        });
        return true;
    }
    catch {
        // пользователь мог заблокировать бота — это не критично
        return false;
    }
}
/** Отправляет пользователю фото с подписью; молча игнорирует ошибки (аналогично notify). */
async function notifyPhoto(telegramId, photoPath, caption) {
    if (!botInstance)
        return false;
    try {
        await botInstance.telegram.sendPhoto(telegramId, telegraf_1.Input.fromLocalFile(photoPath), {
            caption,
            parse_mode: 'HTML',
        });
        return true;
    }
    catch {
        return false;
    }
}
/** Рассылает сообщение всем администраторам из ADMIN_IDS (например, обращение в поддержку). */
async function notifyAdmins(text, buttonRows) {
    await Promise.all(config_1.config.adminIds.map((id) => notify(id, text, buttonRows)));
}
