"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createBot = createBot;
const telegraf_1 = require("telegraf");
const config_1 = require("../config");
const userService_1 = require("../services/userService");
const notifier_1 = require("./notifier");
/** Кнопка открытия Mini App — только если известен публичный HTTPS-адрес. */
function appKeyboard() {
    if (!config_1.config.webappUrl)
        return undefined;
    return telegraf_1.Markup.inlineKeyboard([telegraf_1.Markup.button.webApp('🚗 Открыть Поехали 74', config_1.config.webappUrl)]);
}
function replyOpenApp(ctx) {
    const keyboard = appKeyboard();
    if (keyboard) {
        ctx.reply('Открыть приложение:', keyboard);
    }
    else {
        ctx.reply('Приложение скоро будет доступно — сейчас настраивается публичный адрес. ' +
            'Загляните чуть позже, я пришлю кнопку «Открыть Поехали 74».');
    }
}
function createBot() {
    const bot = new telegraf_1.Telegraf(config_1.config.botToken);
    (0, notifier_1.setBotInstance)(bot);
    if (!config_1.config.webappUrl) {
        console.warn('WEBAPP_URL не задан (или не начинается с https://) — бот запущен без кнопки Mini App. ' +
            'Узнайте публичный домен у вашего хостинга и пропишите его в WEBAPP_URL.');
    }
    bot.start((ctx) => {
        (0, userService_1.upsertUser)({
            id: ctx.from.id,
            first_name: ctx.from.first_name,
            last_name: ctx.from.last_name,
            username: ctx.from.username,
        });
        ctx.reply('🚗 <b>Поехали 74</b> — попутчики Челябинск ⇄ Кунашак\n\n' +
            'Здесь водители публикуют поездки, а пассажиры бронируют места без звонков и лишних сообщений.\n\n' +
            'Чтобы бронировать поездки или публиковать свои — сначала подтвердите номер телефона кнопкой ниже. ' +
            'Это нужно, чтобы в приложении не было фейковых анкет.', {
            parse_mode: 'HTML',
            ...telegraf_1.Markup.keyboard([telegraf_1.Markup.button.contactRequest('📱 Подтвердить номер телефона')])
                .resize()
                .oneTime(),
        });
        replyOpenApp(ctx);
    });
    bot.command('app', (ctx) => {
        replyOpenApp(ctx);
    });
    // Подтверждение номера телефона: Telegram гарантирует, что контакт,
    // отправленный через кнопку request_contact, принадлежит самому пользователю —
    // это и есть защита от фейковых водителей/пассажиров.
    bot.on('contact', (ctx) => {
        const contact = ctx.message.contact;
        if (contact.user_id !== ctx.from.id) {
            ctx.reply('Пожалуйста, отправьте свой собственный номер телефона.');
            return;
        }
        (0, userService_1.upsertUser)({
            id: ctx.from.id,
            first_name: ctx.from.first_name,
            last_name: ctx.from.last_name,
            username: ctx.from.username,
        });
        (0, userService_1.setPhoneVerified)(ctx.from.id, contact.phone_number);
        ctx.reply('✅ Номер подтверждён! Теперь вам доступны бронирование и публикация поездок.', telegraf_1.Markup.removeKeyboard());
        replyOpenApp(ctx);
    });
    bot.command('whoami', (ctx) => {
        const user = (0, userService_1.getUser)(ctx.from.id);
        if (!user) {
            ctx.reply('Сначала напишите /start');
            return;
        }
        ctx.reply(`ID: ${user.telegram_id}\nИмя: ${user.first_name}\nТелефон подтверждён: ${user.phone_verified ? 'да' : 'нет'}`);
    });
    bot.catch((err) => {
        console.error('Ошибка в обработчике бота:', err);
    });
    return bot;
}
