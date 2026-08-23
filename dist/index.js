"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("./db/db");
const config_1 = require("./config");
const app_1 = require("./server/app");
const bot_1 = require("./bot/bot");
async function main() {
    const app = (0, app_1.createApp)();
    app.listen(config_1.config.port, () => {
        console.log(`HTTP-сервер и Mini App запущены на порту ${config_1.config.port}`);
    });
    const bot = (0, bot_1.createBot)();
    await bot.launch();
    console.log('Telegram-бот запущен (long polling)');
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
}
main().catch((err) => {
    console.error('Не удалось запустить приложение:', err);
    process.exit(1);
});
