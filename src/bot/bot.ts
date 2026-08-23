import { Telegraf, Markup } from 'telegraf';
import { config } from '../config';
import { upsertUser, setPhoneVerified, getUser } from '../services/userService';
import { setBotInstance } from './notifier';

export function createBot(): Telegraf {
  const bot = new Telegraf(config.botToken);
  setBotInstance(bot);

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

    ctx.reply(
      'Открыть приложение:',
      Markup.inlineKeyboard([Markup.button.webApp('🚗 Открыть Поехали 74', config.webappUrl)])
    );
  });

  bot.command('app', (ctx) => {
    ctx.reply(
      'Открыть приложение:',
      Markup.inlineKeyboard([Markup.button.webApp('🚗 Открыть Поехали 74', config.webappUrl)])
    );
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
    ctx.reply(
      'Открыть приложение:',
      Markup.inlineKeyboard([Markup.button.webApp('🚗 Открыть Поехали 74', config.webappUrl)])
    );
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
