import { Bot, Keyboard, ImageAttachment } from '@maxhub/max-bot-api';
import { config } from '../config';
import { upsertMaxUser, setPhoneVerified, setFullName, maxStorageId, getUser } from '../services/userService';
import { consumeLoginCode } from '../services/webSessionService';
import { setMaxBotInstance } from './maxNotifier';
import { notifyAdmins, notifyUser } from './notifier';
import { createSupportMessage } from '../services/supportService';
import { confirmBooking, declineBooking, getBookingWithPeople, BookingError } from '../services/bookingService';
import { displayName, platformLabel } from '../utils/displayName';
import { formatDate } from '../utils/dateFormat';
import { escapeTgHtml } from '../utils/escapeHtml';
import { bannerPath, isLoginCodeRateLimited } from './bot';
import { withRetry } from '../utils/retry';

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
 * Явно ли присланный контакт принадлежит НЕ отправителю.
 *
 * Смысл — «отклонять только при доказательстве, что контакт чужой», а не
 * «требовать доказательства, что свой». Это важно вот почему.
 *
 * Штатный путь подтверждения — кнопка requestContact «Поделиться своим
 * номером». Когда пользователь MAX её жмёт, платформа присылает контакт
 * с заполненным vcf_info (там телефон), но payload.tam_info при этом НЕ
 * заполняет — поле необязательное (User | null в типах SDK). Прежняя
 * версия требовала tam_info.user_id === отправитель и потому отклоняла
 * КАЖДОГО легитимного пользователя: подтвердить телефон в MAX не мог
 * никто. Это и была причина жалоб.
 *
 * tam_info появляется, когда пользователь делится РАЗРЕШЁННЫМ контактом
 * конкретного пользователя MAX (например, переслал чужую карточку). Вот
 * этот случай и ловим: если tam_info есть и его user_id — не отправитель,
 * контакт чужой, отклоняем. Если tam_info нет — это кнопка «свой номер»,
 * принимаем.
 *
 * Остаточный риск: карточку незарегистрированного человека (без tam_info)
 * отличить от своего номера нельзя, поэтому такая пройдёт. Это ровно то
 * поведение, что было до добавления проверки, и оно несравнимо лучше, чем
 * блокировать всех. Диагностический лог в обработчике фиксирует форму
 * вложения (без самого телефона) — по реальным логам MAX видно, приходит
 * ли tam_info на кнопку, и проверку можно будет ужесточить точечно.
 */
export function isForeignContact(attachments: unknown, senderUserId: number): boolean {
  if (!Array.isArray(attachments)) return false;
  for (const attachment of attachments) {
    if (!attachment || typeof attachment !== 'object') continue;
    const typed = attachment as { type?: unknown; payload?: { tam_info?: { user_id?: unknown } | null } };
    if (typed.type !== 'contact') continue;
    const uid = typed.payload?.tam_info?.user_id;
    // Отклоняем ТОЛЬКО при явном доказательстве чужого владельца.
    return typeof uid === 'number' && uid !== senderUserId;
  }
  return false;
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
      await withRetry(() =>
        ctx.reply(
          '🚗 Поехали 74 — попутчики Челябинск ⇄ Кунашак ⇄ Аргаяш\n\n' +
            'Здесь водители публикуют поездки, а пассажиры бронируют места без звонков и лишних сообщений.\n\n' +
            'Чтобы бронировать поездки или публиковать свои — подтвердите номер телефона кнопкой ниже.',
          {
            attachments: [
              new ImageAttachment('photos' in image ? { photos: image.photos } : { url: image.url }).toJson(),
              Keyboard.inlineKeyboard([[Keyboard.button.requestContact('📱 Подтвердить номер телефона')]]),
            ],
          }
        )
      );
    } catch (err) {
      console.error('Не удалось отправить баннер в MAX:', err);
      await withRetry(() =>
        ctx.reply(
          '🚗 Поехали 74 — попутчики Челябинск ⇄ Кунашак ⇄ Аргаяш\n\nПодтвердите номер телефона кнопкой ниже.',
          { attachments: [Keyboard.inlineKeyboard([[Keyboard.button.requestContact('📱 Подтвердить номер телефона')]])] }
        )
      );
    }
  });

  bot.on('message_created', async (ctx) => {
    const sender = ctx.message.sender;
    if (!sender) return;

    const contact = ctx.contactInfo;
    if (contact?.tel) {
      // Диагностика формы вложения (без телефона и без имени): по этим
      // строкам из реальных логов MAX видно, приходит ли tam_info на
      // кнопку «Поделиться своим номером». Пока данных с живого MAX нет,
      // это единственный способ узнать поведение платформы наверняка.
      const contactAtt = Array.isArray(ctx.message.body.attachments)
        ? (ctx.message.body.attachments.find(
            (a) => a && typeof a === 'object' && (a as { type?: unknown }).type === 'contact'
          ) as { payload?: { tam_info?: { user_id?: unknown } | null } } | undefined)
        : undefined;
      console.log(
        `[maxBot] контакт от ${sender.user_id}: tam_info=${
          contactAtt?.payload?.tam_info ? `user_id:${contactAtt.payload.tam_info.user_id}` : 'нет'
        }`
      );
      // Отклоняем только карточку, про которую MAX явно сообщил, что она
      // принадлежит ДРУГОМУ пользователю (см. isForeignContact). Кнопка
      // «свой номер» присылает контакт без tam_info — он проходит, иначе
      // подтвердить телефон в MAX не смог бы никто.
      if (isForeignContact(ctx.message.body.attachments, sender.user_id)) {
        await withRetry(() =>
          ctx.reply('Пожалуйста, отправьте свой собственный номер телефона кнопкой «Подтвердить номер телефона».')
        );
        return;
      }
      const user = upsertMaxUser({ id: sender.user_id, name: sender.name, username: sender.username });
      setPhoneVerified(user.telegram_id, contact.tel);
      if (contact.fullName) setFullName(user.telegram_id, contact.fullName);
      await withRetry(() => ctx.reply('✅ Номер подтверждён! Теперь вам доступны бронирование и публикация поездок.'));
      return;
    }

    const text = ctx.message.body.text?.trim();
    if (!text) return;

    // Код для входа в браузерную (не Mini App) версию сайта — у MAX нет
    // публичного login-виджета для сторонних сайтов, поэтому пользователь
    // получает 6-значный код на сайте и присылает его сюда, боту.
    if (/^\d{6}$/.test(text)) {
      // См. комментарий к isLoginCodeRateLimited в bot.ts — ветка с кодом
      // идёт раньше лимита поддержки, поэтому нужен свой счётчик.
      if (isLoginCodeRateLimited(maxStorageId(sender.user_id))) {
        await withRetry(() =>
          ctx.reply('⏳ Слишком много попыток ввода кода. Подождите немного и запросите новый код на сайте.')
        );
        return;
      }
      const user = upsertMaxUser({ id: sender.user_id, name: sender.name, username: sender.username });
      const linked = consumeLoginCode(text, user.telegram_id);
      await withRetry(() =>
        ctx.reply(
          linked
            ? '✅ Вход подтверждён! Вернитесь на сайт — он войдёт автоматически.'
            : 'Код не найден или уже устарел. Запросите новый код на сайте и попробуйте снова.'
        )
      );
      return;
    }

    if (isSupportRateLimited(sender.user_id)) {
      await withRetry(() => ctx.reply('⏳ Слишком много сообщений подряд. Подождите немного и напишите ещё раз.'));
      return;
    }

    const user = upsertMaxUser({ id: sender.user_id, name: sender.name, username: sender.username });
    createSupportMessage(user.telegram_id, text.slice(0, 1000));
    await notifyAdmins(
      `🆘 <b>Сообщение в поддержку (MAX)</b>\nОт: ${escapeTgHtml(sender.name)}${sender.username ? ' · @' + escapeTgHtml(sender.username) : ''} (ID ${maxStorageId(sender.user_id)})\n\n${escapeTgHtml(text.slice(0, 1000))}`
    );
    await withRetry(() => ctx.reply('✅ Сообщение отправлено в поддержку. Мы ответим вам здесь, в этом чате.'));
  });

  bot.action(/^confirm_booking:(\d+)$/, async (ctx) => {
    const bookingId = Number(ctx.match![1]);
    const driverId = maxStorageId(ctx.callback.user.user_id);
    try {
      confirmBooking(bookingId, driverId);
      const info = getBookingWithPeople(bookingId)!;

      await withRetry(() => ctx.answerOnCallback({ notification: 'Бронирование подтверждено!' }));
      await withRetry(() =>
        ctx.editMessage({
          text:
            `✅ Вы подтвердили бронирование.\n${info.from_city} → ${info.to_city}, ${formatDate(info.departure_at)}\n` +
            `Пассажир (${platformLabel(info.passenger_platform)}): ${escapeTgHtml(displayName(info.passenger_full_name, info.passenger_first_name))}${info.passenger_username ? ' (@' + escapeTgHtml(info.passenger_username) + ')' : ''}\n` +
            `Телефон: ${info.passenger_phone ? escapeTgHtml(info.passenger_phone) : 'не указан'}\n` +
            `Мест: ${info.seats_booked} · Сумма: ${info.price_per_seat * info.seats_booked} ₽`,
          format: 'html',
        })
      );

      await notifyUser(
        getUser(info.passenger_id)!,
        `✅ Водитель подтвердил бронирование!\n${info.from_city} → ${info.to_city}, ${formatDate(info.departure_at)}\n` +
          `Водитель (${platformLabel(info.driver_platform)}): ${escapeTgHtml(displayName(info.driver_full_name, info.driver_first_name))}\nТелефон: ${info.driver_phone ? escapeTgHtml(info.driver_phone) : 'не указан'}\nСумма: ${info.price_per_seat * info.seats_booked} ₽` +
          (info.meeting_point ? `\n📍 Место встречи: ${escapeTgHtml(info.meeting_point)}` : '') +
          (info.dropoff_point ? `\n🏁 Конечная точка: ${escapeTgHtml(info.dropoff_point)}` : '')
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

      await withRetry(() => ctx.answerOnCallback({ notification: 'Бронирование отклонено' }));
      await withRetry(() =>
        ctx.editMessage({
          text: `❌ Вы отклонили бронирование.\n${info.from_city} → ${info.to_city}, ${formatDate(info.departure_at)}\nМесто снова свободно.`,
          format: 'html',
        })
      );

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
