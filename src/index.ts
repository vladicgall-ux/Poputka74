import './db/db';
import { config } from './config';
import { createApp } from './server/app';
import { createBot } from './bot/bot';

async function main() {
  const app = createApp();
  app.listen(config.port, () => {
    console.log(`HTTP-сервер и Mini App запущены на порту ${config.port}`);
  });

  const bot = createBot();
  await bot.launch();
  console.log('Telegram-бот запущен (long polling)');

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

main().catch((err) => {
  console.error('Не удалось запустить приложение:', err);
  process.exit(1);
});
