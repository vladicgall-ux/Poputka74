"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("./db/db");
const config_1 = require("./config");
const app_1 = require("./server/app");
const bot_1 = require("./bot/bot");
const maxBot_1 = require("./bot/maxBot");
const rideService_1 = require("./services/rideService");
const reminders_1 = require("./jobs/reminders");
const SWEEP_INTERVAL_MS = 60000;
async function main() {
    const app = (0, app_1.createApp)();
    app.listen(config_1.config.port, () => {
        console.log(`HTTP-сервер и Mini App запущены на порту ${config_1.config.port}`);
    });
    const bot = (0, bot_1.createBot)();
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
    if (config_1.config.maxBotToken) {
        const maxBot = (0, maxBot_1.createMaxBot)();
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
            (0, rideService_1.sweepExpiredRides)();
        }
        catch (err) {
            console.error('Ошибка при обработке истёкших поездок:', err);
        }
        (0, reminders_1.sendRatingReminders)().catch((err) => console.error('Ошибка при отправке напоминаний об оценке:', err));
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
