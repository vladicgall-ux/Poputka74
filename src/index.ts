import './db/db';
import { config } from './config';
import { createApp } from './server/app';
import { createBot } from './bot/bot';
import { createMaxBot } from './bot/maxBot';
import { sweepExpiredRides } from './services/rideService';
import { sendRatingReminders, sendDepartureReminders, sendPhoneVerificationReminders } from './jobs/reminders';
import { sweepExpiredWebAuth } from './services/webSessionService';
import { generateUpcomingRides } from './services/rideTemplateService';

const SWEEP_INTERVAL_MS = 60_000;

async function main() {
  console.log(
    `NODE_EXTRA_CA_CERTS=${process.env.NODE_EXTRA_CA_CERTS ?? '(не задан)'}`,
  );

  const app = createApp();
  app.listen(config.port, () => {
    console.log(`HTTP-сервер и Mini App запущены на порту ${config.port}`);
  });

  const bot = createBot();
  // ВАЖНО: bot.launch() в режиме long polling не резолвится, пока бот не
  // остановлен (Telegraf держит промис открытым на весь срок жизни опроса) —
  // await здесь блокировал бы вообще весь код ниже (в т.ч. периодические
  // задачи) до самой остановки процесса. Поэтому запускаем без await и сами
  // логируем результат/ошибку запуска.
  bot
    .launch()
    .then(() => console.log('Telegram-бот запущен (long polling)'))
    .catch((err) => console.error('Не удалось запустить Telegram-бота:', err));

  // Бот MAX полностью опционален — создаётся, только если задан
  // MAX_BOT_TOKEN, и не должен мешать боту Telegram, если что-то пойдёт не
  // так. bot.start() у MAX SDK так же не резолвится, пока бот не
  // остановлен — запускаем без await, по той же причине, что и Telegram.
  let maxBot: ReturnType<typeof createMaxBot> | undefined;
  let maxBotShuttingDown = false;
  const MAX_START_RETRY_MS = 30_000;
  if (config.maxBotToken) {
    maxBot = createMaxBot();
    /**
     * Два бага в @maxhub/max-bot-api (long polling), из-за которых бот MAX
     * периодически «навсегда замолкал» (не реагировал вообще ни на что —
     * ни на /start, ни на код входа, ни на кнопки) и оживал только после
     * ручного передеплоя контейнера:
     *
     * 1) Bot.pollingIsStarted выставляется в true ДО await getMyInfo() и
     *    сбрасывается обратно в false только внутри bot.stop(). Если
     *    первый вызов start() падает (например, API MAX вместо JSON отдаёт
     *    HTML-страницу ошибки — типичный сбой их шлюза), наш повторный
     *    вызов startMaxBot() по таймеру натыкается на
     *    `if (pollingIsStarted) return;` и молча ничего не делает — то
     *    есть ВЕСЬ retry-цикл ниже был не более чем красивым логом,
     *    реальных повторных попыток не происходило.
     * 2) В самом long-polling цикле (core/network/polling.js) при
     *    восстановимой ошибке (сеть оборвалась, 429, 5xx) вместо `continue`
     *    стоит `return` — цикл опроса тихо завершается, а start() при этом
     *    РЕЗОЛВИТСЯ, как будто всё в порядке. Мы видели в логах «Бот MAX
     *    запущен» и считали, что всё хорошо, хотя опрос обновлений уже
     *    остановился навсегда после первого же сетевого сбоя.
     *
     * Фикс на нашей стороне (без правки node_modules, чтобы не терять патч
     * при переустановке зависимостей): и на resolve(), и на reject()
     * считаем, что опрос остановился и его нужно поднять заново, а перед
     * каждым повторным start() явно вызываем stop() — это гарантированно
     * сбрасывает pollingIsStarted независимо от того, в каком состоянии
     * баг оставил бота.
     */
    const startMaxBot = () => {
      maxBot!
        .start()
        .then(() => {
          if (maxBotShuttingDown) {
            console.log('Бот MAX остановлен (штатное завершение).');
            return;
          }
          console.warn(
            'Бот MAX: long polling неожиданно завершился (известный баг SDK при сетевой ошибке) — перезапускаю...'
          );
          maxBot!.stop();
          startMaxBot();
        })
        .catch((err) => {
          console.error('Не удалось запустить бота MAX:', err);
          console.log(`Повторная попытка запуска бота MAX через ${MAX_START_RETRY_MS / 1000} секунд...`);
          maxBot!.stop();
          setTimeout(startMaxBot, MAX_START_RETRY_MS);
        });
    };
    startMaxBot();
  }

  // Переводит поездки, время которых прошло, в «выполнена»/«отменена» —
  // без этого статус навсегда оставался бы 'active', даже когда поездка
  // давно состоялась или не состоялась.
  // Через час после поездки напоминает пассажиру оценить водителя.
  const runPeriodicJobs = () => {
    try {
      sweepExpiredRides();
    } catch (err) {
      console.error('Ошибка при обработке истёкших поездок:', err);
    }
    sendRatingReminders().catch((err) => console.error('Ошибка при отправке напоминаний об оценке:', err));
    sendDepartureReminders().catch((err) => console.error('Ошибка при отправке напоминаний об отправлении:', err));
    sendPhoneVerificationReminders().catch((err) =>
      console.error('Ошибка при отправке напоминаний о подтверждении телефона:', err)
    );
    try {
      sweepExpiredWebAuth();
    } catch (err) {
      console.error('Ошибка при очистке истёкших веб-сессий:', err);
    }
    try {
      generateUpcomingRides();
    } catch (err) {
      console.error('Ошибка при генерации регулярных поездок:', err);
    }
  };
  runPeriodicJobs();
  const jobsTimer = setInterval(runPeriodicJobs, SWEEP_INTERVAL_MS);

  // Telegraf/MAX SDK бросают синхронное исключение ('Bot is not running!'),
  // если stop() вызван раньше, чем launch()/start() успел завершить
  // инициализацию (например, сигнал пришёл сразу после старта контейнера) —
  // без try/catch это необработанное исключение в обработчике сигнала
  // валило весь процесс, и хостинг видел бесконечный цикл рестартов вместо
  // штатной остановки.
  const shutdown = (signal: 'SIGINT' | 'SIGTERM') => {
    clearInterval(jobsTimer);
    try {
      bot.stop(signal);
    } catch (err) {
      console.error('Ошибка при остановке Telegram-бота:', err);
    }
    try {
      maxBotShuttingDown = true;
      maxBot?.stop();
    } catch (err) {
      console.error('Ошибка при остановке бота MAX:', err);
    }
    process.exit(0);
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Не удалось запустить приложение:', err);
  process.exit(1);
});
