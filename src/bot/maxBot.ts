import { Bot, Keyboard, ImageAttachment } from '@maxhub/max-bot-api';
import { config } from '../config';
import { upsertMaxUser, setPhoneVerified, setFullName, maxStorageId, getUser } from '../services/userService';
import { consumeMaxLoginCode } from '../services/webSessionService';
import { setMaxBotInstance } from './maxNotifier';
import { notifyAdmins, notifyUser } from './notifier';
import { createSupportMessage } from '../services/supportService';
import { confirmBooking, declineBooking, getBookingWithPeople, BookingError } from '../services/bookingService';
import { displayName, platformLabel } from '../utils/displayName';
import { bannerPath } from './bot';

function formatDate(iso: string): string {
  // См. комментарий в bot.ts::formatDate — без timeZone сервер форматирует
  // по своему часовому поясу (UTC), а не по времени Челябинска/Кунашака.
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Yekaterinburg',
  });
}

/** Тот же принцип, что и лимит поддержки в bot.ts — не даёт заваливать БД/админов текстом. */
const SUPPORT_LIMIT = 5;
const SUPPORT_WINDOW_MS = 60_000;
const supportHits = new Map<number, number[]>();

function isSupportRateLimited(userId: number): boolean {
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
export function createMaxBot(): Bot {
  const bot = new Bot(config.maxBotToken!);
  setMaxBotInstance(bot);

  // Без этого необработанная ошибка в любом апдейте MAX уронит весь процесс
  // (включая уже работающий Telegram-бот) — таково поведение SDK по умолчанию.
  bot.catch((err) => {
    console.error('Ошибка в обработчике бота MAX:', err);
  });

  bot.on('bot_started', async (ctx) => {
    upsertMaxUser({ id: ctx.user.user_id, name: ctx.user.name, username: ctx.user.username });
    try {
      const image = await ctx.api.uploadImage({ source: bannerPath });
      await ctx.reply(
        '🚗 Поехали 74 — попутчики Челябинск ⇄ Кунашак\n\n' +
          'Здесь водители публикуют поездки, а пассажиры бронируют места без звонков и лишних сообщений.\n\n' +
          'Чтобы бронировать поездки или публиковать свои — подтвердите номер телефона кнопкой ниже.',
        {
          attachments: [
            new ImageAttachment('photos' in image ? { photos: image.photos } : { url: image.url }).toJson(),
            Keyboard.inlineKeyboard([[Keyboard.button.requestContact('📱 Подтвердить номер телефона')]]),
          ],
        }
      );
    } catch (err) {
      console.error('Не удалось отправить баннер в MAX:', err);
      await ctx.reply(
        '🚗 Поехали 74 — попутчики Челябинск ⇄ Кунашак\n\nПодтвердите номер телефона кнопкой ниже.',
        { attachments: [Keyboard.inlineKeyboard([[Keyboard.button.requestContact('📱 Подтвердить номер телефона')]])] }
      );
    }
  });

  bot.on('message_created', async (ctx) => {
    const sender = ctx.message.sender;
    if (!sender) return;

    const contact = ctx.contactInfo;
    if (contact?.tel) {
      const user = upsertMaxUser({ id: sender.user_id, name: sender.name, username: sender.username });
      setPhoneVerified(user.telegram_id, contact.tel);
      if (contact.fullName) setFullName(user.telegram_id, contact.fullName);
      await ctx.reply('✅ Номер подтверждён! Теперь вам доступны бронирование и публикация поездок.');
      return;
    }

    const text = ctx.message.body.text?.trim();
    if (!text) return;

    // Код для входа в браузерную (не Mini App) версию сайта — у MAX нет
    // публичного login-виджета для сторонних сайтов, поэтому пользователь
    // получает 6-значный код на сайте и присылает его сюда, боту.
    if (/^\d{6}$/.test(text)) {
      const user = upsertMaxUser({ id: sender.user_id, name: sender.name, username: sender.username });
      const linked = consumeMaxLoginCode(text, user.telegram_id);
      await ctx.reply(
        linked
          ? '✅ Вход подтверждён! Вернитесь на сайт — он войдёт автоматически.'
          : 'Код не найден или уже устарел. Запросите новый код на сайте и попробуйте снова.'
      );
      return;
    }

    if (isSupportRateLimited(sender.user_id)) {
      await ctx.reply('⏳ Слишком много сообщений подряд. Подождите немного и напишите ещё раз.');
      return;
    }

    const user = upsertMaxUser({ id: sender.user_id, name: sender.name, username: sender.username });
    createSupportMessage(user.telegram_id, text.slice(0, 1000));
    await notifyAdmins(
      `🆘 <b>Сообщение в поддержку (MAX)</b>\nОт: ${sender.name}${sender.username ? ' · @' + sender.username : ''} (ID ${maxStorageId(sender.user_id)})\n\n${text}`
    );
    await ctx.reply('✅ Сообщение отправлено в поддержку. Мы ответим вам здесь, в этом чате.');
  });

  bot.action(/^confirm_booking:(\d+)$/, async (ctx) => {
    const bookingId = Number(ctx.match![1]);
    const driverId = maxStorageId(ctx.callback.user.user_id);
    try {
      confirmBooking(bookingId, driverId);
      const info = getBookingWithPeople(bookingId)!;

      await ctx.answerOnCallback({ notification: 'Бронирование подтверждено!' });
      await ctx.editMessage({
        text:
          `✅ Вы подтвердили бронирование.\n${info.from_city} → ${info.to_city}, ${formatDate(info.departure_at)}\n` +
          `Пассажир (${platformLabel(info.passenger_platform)}): ${displayName(info.passenger_full_name, info.passenger_first_name)}${info.passenger_username ? ' (@' + info.passenger_username + ')' : ''}\n` +
          `Телефон: ${info.passenger_phone ?? 'не указан'}\n` +
          `Мест: ${info.seats_booked} · Сумма: ${info.price_per_seat * info.seats_booked} ₽`,
        format: 'html',
      });

      await notifyUser(
        getUser(info.passenger_id)!,
        `✅ Водитель подтвердил бронирование!\n${info.from_city} → ${info.to_city}, ${formatDate(info.departure_at)}\n` +
          `Водитель (${platformLabel(info.driver_platform)}): ${displayName(info.driver_full_name, info.driver_first_name)}\nТелефон: ${info.driver_phone ?? 'не указан'}\nСумма: ${info.price_per_seat * info.seats_booked} ₽`
      );
    } catch (err) {
      const message = err instanceof BookingError ? err.message : 'Не удалось подтвердить бронирование';
      await ctx.answerOnCallback({ notification: message });
    }
  });

  bot.action(/^decline_booking:(\d+)$/, async (ctx) => {
    const bookingId = Number(ctx.match![1]);
    const driverId = maxStorageId(ctx.callback.user.user_id);
    try {
      const info = getBookingWithPeople(bookingId)!;
      declineBooking(bookingId, driverId);

      await ctx.answerOnCallback({ notification: 'Бронирование отклонено' });
      await ctx.editMessage({
        text: `❌ Вы отклонили бронирование.\n${info.from_city} → ${info.to_city}, ${formatDate(info.departure_at)}\nМесто снова свободно.`,
        format: 'html',
      });

      await notifyUser(
        getUser(info.passenger_id)!,
        `❌ Водитель отклонил бронирование на поездку ${info.from_city} → ${info.to_city} (${formatDate(info.departure_at)}).\nПопробуйте забронировать другую поездку в приложении.`
      );
    } catch (err) {
      const message = err instanceof BookingError ? err.message : 'Не удалось отклонить бронирование';
      await ctx.answerOnCallback({ notification: message });
    }
  });

  return bot;
}
