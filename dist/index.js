"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("./db/db");
const config_1 = require("./config");
const app_1 = require("./server/app");
const bot_1 = require("./bot/bot");
const rideService_1 = require("./services/rideService");
const SWEEP_INTERVAL_MS = 60000;
async function main() {
    const app = (0, app_1.createApp)();
    app.listen(config_1.config.port, () => {
        console.log(`HTTP-сервер и Mini App запущены на порту ${config_1.config.port}`);
    });
    const bot = (0, bot_1.createBot)();
    await bot.launch();
    console.log('Telegram-бот запущен (long polling)');
    // Переводит поездки, время которых прошло, в «выполнена»/«отменена» —
    // без этого статус навсегда оставался бы 'active', даже когда поездка
    // давно состоялась или не состоялась.
    (0, rideService_1.sweepExpiredRides)();
    const sweepTimer = setInterval(() => {
        try {
            (0, rideService_1.sweepExpiredRides)();
        }
        catch (err) {
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
