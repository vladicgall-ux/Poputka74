import { Telegraf, Markup } from 'telegraf';
import { config } from '../config';
import { upsertUser, setPhoneVerified, getUser } from '../services/userService';
import { setBotInstance } from './notifier';

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

    ctx.reply(
      '🚗 <b>Поехали 74</b> — попутчики Челябинск ⇄ Кунашак\n\n' +
        'Здесь водители публикуют поездки, а пассажиры бронируют места без звонков и лишних сообщений.\n\n' +
        'Чтобы бронировать поездки или публиковать свои — сначала подтвердите номер телефона кнопкой ниже. ' +
        'Это нужно, чтобы в приложении не было фейковых анкет.',
      {
        parse_mode: 'HTML',
        ...Markup.keyboard([Markup.button.contactRequest('📱 Подтвердить номер телефона')])
          .resize()
          .oneTime(),
      }
    );

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

  bot.catch((err) => {
    console.error('Ошибка в обработчике бота:', err);
  });

  return bot;
}
