"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.withRetry = withRetry;
/**
 * API MAX временами отвечает временной ошибкой на одиночный вызов (тот же
 * нестабильный шлюз, из-за которого чинили long polling в index.ts) — без
 * повтора это выглядит как «бот принял действие, но не ответил»: например,
 * код входа успешно привязался к аккаунту (сайт вошёл), а подтверждение в
 * чате MAX не пришло вовсе, и пользователь остаётся в недоумении. Один
 * повтор с небольшой паузой закрывает подавляющее большинство таких
 * временных сбоев, не пытаясь бесконечно бороться с настоящим сбоем.
 */
async function withRetry(fn, label) {
    try {
        return await fn();
    }
    catch (err) {
        console.error(`Вызов API MAX не удался${label ? ` (${label})` : ''}, повтор через 1.5с:`, err);
        await new Promise((resolve) => setTimeout(resolve, 1500));
        return fn();
    }
}
