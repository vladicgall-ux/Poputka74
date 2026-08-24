"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMaxBot = createMaxBot;
const max_bot_api_1 = require("@maxhub/max-bot-api");
const config_1 = require("../config");
const userService_1 = require("../services/userService");
const maxNotifier_1 = require("./maxNotifier");
const notifier_1 = require("./notifier");
const supportService_1 = require("../services/supportService");
const bot_1 = require("./bot");
/** Тот же принцип, что и лимит поддержки в bot.ts — не даёт заваливать БД/админов текстом. */
const SUPPORT_LIMIT = 5;
const SUPPORT_WINDOW_MS = 60000;
const supportHits = new Map();
function isSupportRateLimited(userId) {
    const now = Date.now();
    const hits = (supportHits.get(userId) ?? []).filter((t) => now - t < SUPPORT_WINDOW_MS);
    hits.push(now);
    supportHits.set(userId, hits);
    return hits.length > SUPPORT_LIMIT;
}
/**
 * Бот MAX — параллельно с Telegram-ботом, полностью опционален (не создаётся,
 * если MAX_BOT_TOKEN не задан). Пока умеет только регистрацию + подтверждение
 * телефона + пересылку сообщений в поддержку — как первый шаг перед тем, как
 * подключать полноценное MAX Mini App (там понадобится validateMaxInitData,
 * который ещё не проверен на реальных данных, см. utils/maxAuth.ts).
 */
function createMaxBot() {
    const bot = new max_bot_api_1.Bot(config_1.config.maxBotToken);
    (0, maxNotifier_1.setMaxBotInstance)(bot);
    // Без этого необработанная ошибка в любом апдейте MAX уронит весь процесс
    // (включая уже работающий Telegram-бот) — таково поведение SDK по умолчанию.
    bot.catch((err) => {
        console.error('Ошибка в обработчике бота MAX:', err);
    });
    bot.on('bot_started', async (ctx) => {
        (0, userService_1.upsertMaxUser)({ id: ctx.user.user_id, name: ctx.user.name, username: ctx.user.username });
        try {
            const image = await ctx.api.uploadImage({ source: bot_1.bannerPath });
            await ctx.reply('🚗 Поехали 74 — попутчики Челябинск ⇄ Кунашак\n\n' +
                'Здесь водители публикуют поездки, а пассажиры бронируют места без звонков и лишних сообщений.\n\n' +
                'Чтобы бронировать поездки или публиковать свои — подтвердите номер телефона кнопкой ниже.', {
                attachments: [
                    new max_bot_api_1.ImageAttachment('photos' in image ? { photos: image.photos } : { url: image.url }).toJson(),
                    max_bot_api_1.Keyboard.inlineKeyboard([[max_bot_api_1.Keyboard.button.requestContact('📱 Подтвердить номер телефона')]]),
                ],
            });
        }
        catch (err) {
            console.error('Не удалось отправить баннер в MAX:', err);
            await ctx.reply('🚗 Поехали 74 — попутчики Челябинск ⇄ Кунашак\n\nПодтвердите номер телефона кнопкой ниже.', { attachments: [max_bot_api_1.Keyboard.inlineKeyboard([[max_bot_api_1.Keyboard.button.requestContact('📱 Подтвердить номер телефона')]])] });
        }
    });
    bot.on('message_created', async (ctx) => {
        const sender = ctx.message.sender;
        if (!sender)
            return;
        const contact = ctx.contactInfo;
        if (contact?.tel) {
            const user = (0, userService_1.upsertMaxUser)({ id: sender.user_id, name: sender.name, username: sender.username });
            (0, userService_1.setPhoneVerified)(user.telegram_id, contact.tel);
            if (contact.fullName)
                (0, userService_1.setFullName)(user.telegram_id, contact.fullName);
            await ctx.reply('✅ Номер подтверждён! Теперь вам доступны бронирование и публикация поездок.');
            return;
        }
        const text = ctx.message.body.text?.trim();
        if (!text)
            return;
        if (isSupportRateLimited(sender.user_id)) {
            await ctx.reply('⏳ Слишком много сообщений подряд. Подождите немного и напишите ещё раз.');
            return;
        }
        const user = (0, userService_1.upsertMaxUser)({ id: sender.user_id, name: sender.name, username: sender.username });
        (0, supportService_1.createSupportMessage)(user.telegram_id, text.slice(0, 1000));
        await (0, notifier_1.notifyAdmins)(`🆘 <b>Сообщение в поддержку (MAX)</b>\nОт: ${sender.name}${sender.username ? ' · @' + sender.username : ''} (ID ${(0, userService_1.maxStorageId)(sender.user_id)})\n\n${text}`);
        await ctx.reply('✅ Сообщение отправлено в поддержку. Мы ответим вам здесь, в этом чате.');
    });
    return bot;
}
