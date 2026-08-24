import './db/db';
import { config } from './config';
import { createApp } from './server/app';
import { createBot } from './bot/bot';
import { createMaxBot } from './bot/maxBot';
import { sweepExpiredRides } from './services/rideService';
import { sendRatingReminders } from './jobs/reminders';

const SWEEP_INTERVAL_MS = 60_000;

async function main() {
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
  if (config.maxBotToken) {
    const maxBot = createMaxBot();
    maxBot
      .start()
      .then(() => console.log('Бот MAX запущен (long polling)'))
      .catch((err) => console.error('Не удалось запустить бота MAX:', err));
    process.once('SIGINT', () => maxBot.stop());
    process.once('SIGTERM', () => maxBot.stop());
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

  process.once('SIGINT', () => {
    clearInterval(jobsTimer);
    bot.stop('SIGINT');
  });
  process.once('SIGTERM', () => {
    clearInterval(jobsTimer);
    bot.stop('SIGTERM');
  });
}

main().catch((err) => {
  console.error('Не удалось запустить приложение:', err);
  process.exit(1);
});
