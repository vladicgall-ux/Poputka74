"use strict";
/**
 * Одиночный повтор вызова API MAX при ВРЕМЕННОЙ ошибке.
 *
 * Зачем повтор: шлюз MAX временами отвечает временной ошибкой на
 * одиночный вызов (тот же нестабильный шлюз, из-за которого чинили long
 * polling в index.ts) — без повтора это выглядит как «бот принял
 * действие, но не ответил»: например, код входа успешно привязался, а
 * подтверждение в чате не пришло. Один повтор с паузой закрывает
 * большинство таких сбоев.
 *
 * Но повторять и логировать нужно НЕ всё. Есть постоянные ошибки, для
 * которых повтор бессмысленен, а полный стек в логах только пугает и
 * засоряет вывод. Главный пример — 403 chat.denied / dialog.suspended:
 * пользователь заблокировал бота или не открывал диалог, писать ему
 * нельзя, и это нормальная ситуация (особенно в цикле напоминаний по
 * многим пользователям). Такие ошибки пробрасываем сразу, без повтора и
 * без шумного лога; вызывающий код (notifyMax* в maxNotifier) их и так
 * ловит и возвращает false.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.withRetry = withRetry;
/**
 * Ошибку стоит повторять, только если она похожа на временную: сетевой
 * сбой (нет HTTP-статуса вовсе), 429 (слишком часто) или 5xx (сбой на
 * стороне MAX). Остальные 4xx — постоянные (доступ запрещён, диалог
 * остановлен, некорректный запрос): повтор их не исправит.
 */
function isTransient(err) {
    const status = err?.status;
    if (typeof status !== 'number')
        return true; // сеть/таймаут — без статуса
    if (status === 429)
        return true;
    return status >= 500;
}
/** Короткое описание ошибки для лога — без полного стека и без стенки текста. */
function shortReason(err) {
    const e = err;
    const status = typeof e?.status === 'number' ? `HTTP ${e.status}` : 'без статуса';
    const code = e?.response?.code ? ` ${String(e.response.code)}` : '';
    return `${status}${code}`;
}
async function withRetry(fn, label) {
    try {
        return await fn();
    }
    catch (err) {
        const tag = label ? ` (${label})` : '';
        if (!isTransient(err)) {
            // Постоянная ошибка (например, пользователь заблокировал бота) —
            // не повторяем и не печатаем стек, только короткую причину.
            console.log(`[maxRetry] вызов API MAX${tag} отклонён без повтора: ${shortReason(err)}`);
            throw err;
        }
        console.error(`Вызов API MAX не удался${tag} (${shortReason(err)}), повтор через 1.5с`);
        await new Promise((resolve) => setTimeout(resolve, 1500));
        return fn();
    }
}
