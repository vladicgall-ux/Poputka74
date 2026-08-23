import { Telegraf, Markup, Input } from 'telegraf';
import path from 'path';
import { config } from '../config';
import { upsertUser, setPhoneVerified, getUser } from '../services/userService';
import { setBotInstance, notify, type NotifyButton } from './notifier';
import { confirmBooking, declineBooking, getBookingWithPeople, BookingError } from '../services/bookingService';

const bannerPath = path.join(__dirname, '..', '..', 'public', 'assets', 'banner.png');

/** Ряд с кнопкой, открывающей личный чат с собеседником — только если у него есть username. */
function dialogRows(text: string, username: string | null): NotifyButton[][] | undefined {
  if (!username) return undefined;
  return [[{ text, url: `https://t.me/${username}` }]];
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Кнопка открытия Mini App — только если известен публичный HTTPS-адрес. */
function appKeyboard() {
  if (!config.webappUrl) return undefined;
  return Markup.inlineKeyboard([Markup.button.webApp('🚗 Открыть Поехали 74', config.webappUrl)]);
}

function replyOpenApp(ctx: { reply: (text: string, extra?: object) => unknown }) {
  const keyboard = appKeyboard();
  if (keyboard) {
    ctx.reply('Открыть приложение:', keyboard);
  } else {
    ctx.reply(
      'Приложение скоро будет доступно — сейчас настраивается публичный адрес. ' +
        'Загляните чуть позже, я пришлю кнопку «Открыть Поехали 74».'
    );
  }
}

export function createBot(): Telegraf {
  const bot = new Telegraf(config.botToken);
  setBotInstance(bot);

  if (!config.webappUrl) {
    console.warn(
      'WEBAPP_URL не задан (или не начинается с https://) — бот запущен без кнопки Mini App. ' +
        'Узнайте публичный домен у вашего хостинга и пропишите его в WEBAPP_URL.'
    );
  }

  bot.start((ctx) => {
    upsertUser({
      id: ctx.from.id,
      first_name: ctx.from.first_name,
      last_name: ctx.from.last_name,
      username: ctx.from.username,
    });

    ctx.replyWithPhoto(Input.fromLocalFile(bannerPath), {
      caption:
        '🚗 <b>Поехали 74</b> — попутчики Челябинск ⇄ Кунашак\n\n' +
        'Здесь водители публикуют поездки, а пассажиры бронируют места без звонков и лишних сообщений.\n\n' +
        'Чтобы бронировать поездки или публиковать свои — сначала подтвердите номер телефона кнопкой ниже. ' +
        'Это нужно, чтобы в приложении не было фейковых анкет.',
      parse_mode: 'HTML',
      ...Markup.keyboard([Markup.button.contactRequest('📱 Подтвердить номер телефона')])
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
    upsertUser({
      id: ctx.from.id,
      first_name: ctx.from.first_name,
      last_name: ctx.from.last_name,
      username: ctx.from.username,
    });
    setPhoneVerified(ctx.from.id, contact.phone_number);
    ctx.reply(
      '✅ Номер подтверждён! Теперь вам доступны бронирование и публикация поездок.',
      Markup.removeKeyboard()
    );
    replyOpenApp(ctx);
  });

  bot.command('whoami', (ctx) => {
    const user = getUser(ctx.from.id);
    if (!user) {
      ctx.reply('Сначала напишите /start');
      return;
    }
    ctx.reply(
      `ID: ${user.telegram_id}\nИмя: ${user.first_name}\nТелефон подтверждён: ${
        user.phone_verified ? 'да' : 'нет'
      }`
    );
  });

  bot.action(/^confirm_booking:(\d+)$/, async (ctx) => {
    const bookingId = Number(ctx.match[1]);
    try {
      confirmBooking(bookingId, ctx.from.id);
      const info = getBookingWithPeople(bookingId)!;

      const passengerButtons = dialogRows('💬 Написать пассажиру', info.passenger_username);
      await ctx.answerCbQuery('Бронирование подтверждено!');
      await ctx.editMessageText(
        `✅ Вы подтвердили бронирование.\n${info.from_city} → ${info.to_city}, ${formatDate(info.departure_at)}\n` +
          `Пассажир: ${info.passenger_first_name}${info.passenger_username ? ' (@' + info.passenger_username + ')' : ''}\n` +
          `Телефон: ${info.passenger_phone ?? 'не указан'}\n` +
          `Мест: ${info.seats_booked} · Сумма: ${info.price_per_seat * info.seats_booked} ₽`,
        {
          parse_mode: 'HTML',
          ...(passengerButtons ? Markup.inlineKeyboard(passengerButtons) : {}),
        }
      );

      await notify(
        info.passenger_id,
        `✅ Водитель подтвердил бронирование!\n${info.from_city} → ${info.to_city}, ${formatDate(info.departure_at)}\n` +
          `Водитель: ${info.driver_first_name}\nСумма: ${info.price_per_seat * info.seats_booked} ₽`,
        dialogRows('💬 Написать водителю', info.driver_username)
      );
    } catch (err) {
      const message = err instanceof BookingError ? err.message : 'Не удалось подтвердить бронирование';
      await ctx.answerCbQuery(message, { show_alert: true });
    }
  });

  bot.action(/^decline_booking:(\d+)$/, async (ctx) => {
    const bookingId = Number(ctx.match[1]);
    try {
      const info = getBookingWithPeople(bookingId)!;
      declineBooking(bookingId, ctx.from.id);

      await ctx.answerCbQuery('Бронирование отклонено');
      await ctx.editMessageText(
        `❌ Вы отклонили бронирование.\n${info.from_city} → ${info.to_city}, ${formatDate(info.departure_at)}\nМесто снова свободно.`
      );

      await notify(
        info.passenger_id,
        `❌ Водитель отклонил бронирование на поездку ${info.from_city} → ${info.to_city} (${formatDate(info.departure_at)}).\nПопробуйте забронировать другую поездку в приложении.`
      );
    } catch (err) {
      const message = err instanceof BookingError ? err.message : 'Не удалось отклонить бронирование';
      await ctx.answerCbQuery(message, { show_alert: true });
    }
  });

  bot.catch((err) => {
    console.error('Ошибка в обработчике бота:', err);
  });

  return bot;
}
