"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.bannerPath = void 0;
exports.createBot = createBot;
const telegraf_1 = require("telegraf");
const path_1 = __importDefault(require("path"));
const config_1 = require("../config");
const userService_1 = require("../services/userService");
const notifier_1 = require("./notifier");
const bookingService_1 = require("../services/bookingService");
const supportService_1 = require("../services/supportService");
const displayName_1 = require("../utils/displayName");
exports.bannerPath = path_1.default.join(__dirname, '..', '..', 'public', 'assets', 'banner.png');
/**
 * Простой лимит на сообщения в поддержку через бота: без него любой
 * пользователь может слать текст бесконечно, заваливая БД и Telegram
 * администраторов. Храним в памяти процесса — этого достаточно для
 * одного инстанса бота (long polling, без масштабирования по репликам).
 */
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
/** Ряд с кнопкой, открывающей личный чат с собеседником — только если у него есть username. */
function dialogRows(text, username) {
    if (!username)
        return undefined;
    return [[{ text, url: `https://t.me/${username}` }]];
}
function formatDate(iso) {
    return new Date(iso).toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
}
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
/** Кнопки на документы — только если известен публичный HTTPS-адрес (там же лежат сами страницы). */
function legalKeyboard() {
    if (!config_1.config.webappUrl)
        return undefined;
    return telegraf_1.Markup.inlineKeyboard([
        [telegraf_1.Markup.button.url('📄 Пользовательское соглашение', `${config_1.config.webappUrl}/oferta.html`)],
        [telegraf_1.Markup.button.url('🔒 Политика персональных данных', `${config_1.config.webappUrl}/privacy.html`)],
    ]);
}
function createBot() {
    const bot = new telegraf_1.Telegraf(config_1.config.botToken);
    (0, notifier_1.setBotInstance)(bot);
    if (!config_1.config.webappUrl) {
        console.warn('WEBAPP_URL не задан (или не начинается с https://) — бот запущен без кнопки Mini App. ' +
            'Узнайте публичный домен у вашего хостинга и пропишите его в WEBAPP_URL.');
    }
    else {
        // Кнопка меню слева от поля ввода — открывает Mini App без команды /start.
        // Настраивается сама при каждом запуске, синхронизируясь с текущим WEBAPP_URL.
        bot.telegram
            .setChatMenuButton({
            menuButton: { type: 'web_app', text: 'Поехали 74', web_app: { url: config_1.config.webappUrl } },
        })
            .catch((err) => console.error('Не удалось установить кнопку меню:', err));
    }
    bot.start((ctx) => {
        (0, userService_1.upsertUser)({
            id: ctx.from.id,
            first_name: ctx.from.first_name,
            last_name: ctx.from.last_name,
            username: ctx.from.username,
        });
        ctx.replyWithPhoto(telegraf_1.Input.fromLocalFile(exports.bannerPath), {
            caption: '🚗 <b>Поехали 74</b> — попутчики Челябинск ⇄ Кунашак\n\n' +
                'Здесь водители публикуют поездки, а пассажиры бронируют места без звонков и лишних сообщений.\n\n' +
                'Чтобы бронировать поездки или публиковать свои — сначала подтвердите номер телефона кнопкой ниже. ' +
                'Это нужно, чтобы в приложении не было фейковых анкет.',
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
        const legal = legalKeyboard();
        if (legal) {
            ctx.reply('Продолжая пользоваться сервисом, вы принимаете условия:', legal);
        }
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
    bot.action(/^confirm_booking:(\d+)$/, async (ctx) => {
        const bookingId = Number(ctx.match[1]);
        try {
            (0, bookingService_1.confirmBooking)(bookingId, ctx.from.id);
            const info = (0, bookingService_1.getBookingWithPeople)(bookingId);
            const passengerButtons = dialogRows('💬 Написать пассажиру', info.passenger_username);
            await ctx.answerCbQuery('Бронирование подтверждено!');
            await ctx.editMessageText(`✅ Вы подтвердили бронирование.\n${info.from_city} → ${info.to_city}, ${formatDate(info.departure_at)}\n` +
                `Пассажир: ${(0, displayName_1.displayName)(info.passenger_full_name, info.passenger_first_name)}${info.passenger_username ? ' (@' + info.passenger_username + ')' : ''}\n` +
                `Телефон: ${info.passenger_phone ?? 'не указан'}\n` +
                `Мест: ${info.seats_booked} · Сумма: ${info.price_per_seat * info.seats_booked} ₽`, {
                parse_mode: 'HTML',
                ...(passengerButtons ? telegraf_1.Markup.inlineKeyboard(passengerButtons) : {}),
            });
            await (0, notifier_1.notify)(info.passenger_id, `✅ Водитель подтвердил бронирование!\n${info.from_city} → ${info.to_city}, ${formatDate(info.departure_at)}\n` +
                `Водитель: ${(0, displayName_1.displayName)(info.driver_full_name, info.driver_first_name)}\nТелефон: ${info.driver_phone ?? 'не указан'}\nСумма: ${info.price_per_seat * info.seats_booked} ₽`, dialogRows('💬 Написать водителю', info.driver_username));
        }
        catch (err) {
            const message = err instanceof bookingService_1.BookingError ? err.message : 'Не удалось подтвердить бронирование';
            await ctx.answerCbQuery(message, { show_alert: true });
        }
    });
    bot.action(/^decline_booking:(\d+)$/, async (ctx) => {
        const bookingId = Number(ctx.match[1]);
        try {
            const info = (0, bookingService_1.getBookingWithPeople)(bookingId);
            (0, bookingService_1.declineBooking)(bookingId, ctx.from.id);
            await ctx.answerCbQuery('Бронирование отклонено');
            await ctx.editMessageText(`❌ Вы отклонили бронирование.\n${info.from_city} → ${info.to_city}, ${formatDate(info.departure_at)}\nМесто снова свободно.`);
            await (0, notifier_1.notify)(info.passenger_id, `❌ Водитель отклонил бронирование на поездку ${info.from_city} → ${info.to_city} (${formatDate(info.departure_at)}).\nПопробуйте забронировать другую поездку в приложении.`);
        }
        catch (err) {
            const message = err instanceof bookingService_1.BookingError ? err.message : 'Не удалось отклонить бронирование';
            await ctx.answerCbQuery(message, { show_alert: true });
        }
    });
    // Ловим любой обычный текст, не обработанный выше (команды и контакт
    // перехватываются раньше и сюда не попадают) — это и есть «Поддержка»:
    // всё, что пишут боту, долетает администратору и сохраняется в БД.
    bot.on('text', async (ctx) => {
        if (config_1.config.adminIds.includes(ctx.from.id))
            return; // не шлём админу его же сообщения
        const text = ctx.message.text.trim();
        if (!text)
            return;
        if (isSupportRateLimited(ctx.from.id)) {
            ctx.reply('⏳ Слишком много сообщений подряд. Подождите немного и напишите ещё раз.');
            return;
        }
        (0, userService_1.upsertUser)({
            id: ctx.from.id,
            first_name: ctx.from.first_name,
            last_name: ctx.from.last_name,
            username: ctx.from.username,
        });
        (0, supportService_1.createSupportMessage)(ctx.from.id, text.slice(0, 1000));
        const user = (0, userService_1.getUser)(ctx.from.id);
        const senderName = [
            (0, displayName_1.displayName)(user?.full_name, ctx.from.first_name),
            ctx.from.username ? `@${ctx.from.username}` : null,
        ]
            .filter(Boolean)
            .join(' ');
        await (0, notifier_1.notifyAdmins)(`🆘 <b>Сообщение в поддержку</b>\nОт: ${senderName} (ID ${ctx.from.id})${user?.phone ? `, ${user.phone}` : ''}\n\n${text}`, dialogRows('💬 Написать в ответ', ctx.from.username ?? null));
        ctx.reply('✅ Сообщение отправлено в поддержку. Мы ответим вам здесь, в этом чате.');
    });
    bot.catch((err) => {
        console.error('Ошибка в обработчике бота:', err);
    });
    return bot;
}
