import './db/db';
import { config } from './config';
import { createApp } from './server/app';
import { createBot } from './bot/bot';
import { createMaxBot } from './bot/maxBot';
import { sweepExpiredRides } from './services/rideService';
import { sendRatingReminders } from './jobs/reminders';

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
  if (config.maxBotToken) {
    maxBot = createMaxBot();
    maxBot
      .start()
      .then(() => console.log('Бот MAX запущен (long polling)'))
      .catch((err) => console.error('Не удалось запустить бота MAX:', err));
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
