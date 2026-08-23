import './db/db';
import { config } from './config';
import { createApp } from './server/app';
import { createBot } from './bot/bot';
import { sweepExpiredRides } from './services/rideService';

const SWEEP_INTERVAL_MS = 60_000;

async function main() {
  const app = createApp();
  app.listen(config.port, () => {
    console.log(`HTTP-сервер и Mini App запущены на порту ${config.port}`);
  });

  const bot = createBot();
  await bot.launch();
  console.log('Telegram-бот запущен (long polling)');

  // Переводит поездки, время которых прошло, в «выполнена»/«отменена» —
  // без этого статус навсегда оставался бы 'active', даже когда поездка
  // давно состоялась или не состоялась.
  sweepExpiredRides();
  const sweepTimer = setInterval(() => {
    try {
      sweepExpiredRides();
    } catch (err) {
      console.error('Ошибка при обработке истёкших поездок:', err);
    }
  }, SWEEP_INTERVAL_MS);

  process.once('SIGINT', () => {
    clearInterval(sweepTimer);
    bot.stop('SIGINT');
  });
  process.once('SIGTERM', () => {
    clearInterval(sweepTimer);
    bot.stop('SIGTERM');
  });
}

main().catch((err) => {
  console.error('Не удалось запустить приложение:', err);
  process.exit(1);
});
