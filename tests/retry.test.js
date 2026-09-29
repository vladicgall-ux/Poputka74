/**
 * Тесты повтора вызовов API MAX: временные ошибки повторяются один раз,
 * постоянные (4xx кроме 429) — пробрасываются сразу без повтора.
 */
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

process.env.BOT_TOKEN = '123456:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'poputka-retry-test-')), 'test.db');

const { withRetry } = require('../dist/utils/retry');

function failing(times, err) {
  let n = 0;
  return async () => {
    n += 1;
    if (n <= times) throw err;
    return 'ok';
  };
}
function attempts(fn) {
  let n = 0;
  const wrapped = async () => {
    n += 1;
    return fn();
  };
  return { wrapped, count: () => n };
}

test('успех с первого раза — без повтора', async () => {
  const a = attempts(async () => 'ok');
  assert.strictEqual(await withRetry(a.wrapped), 'ok');
  assert.strictEqual(a.count(), 1);
});

test('временная ошибка (нет статуса) — один повтор, затем успех', async () => {
  const fn = failing(1, new Error('сеть отвалилась'));
  const a = attempts(fn);
  assert.strictEqual(await withRetry(a.wrapped), 'ok');
  assert.strictEqual(a.count(), 2);
});

test('временная ошибка 503 — повторяется', async () => {
  const err = Object.assign(new Error('server'), { status: 503 });
  const fn = failing(1, err);
  const a = attempts(fn);
  assert.strictEqual(await withRetry(a.wrapped), 'ok');
  assert.strictEqual(a.count(), 2);
});

test('429 — повторяется', async () => {
  const err = Object.assign(new Error('too many'), { status: 429 });
  const fn = failing(1, err);
  const a = attempts(fn);
  assert.strictEqual(await withRetry(a.wrapped), 'ok');
  assert.strictEqual(a.count(), 2);
});

test('постоянная 403 chat.denied — БЕЗ повтора, ошибка пробрасывается', async () => {
  // Ровно случай из логов: пользователь заблокировал бота / не открыл
  // диалог. Повторять бессмысленно.
  const err = Object.assign(new Error('denied'), {
    status: 403,
    response: { code: 'chat.denied', message: 'error.dialog.suspended' },
  });
  const a = attempts(async () => {
    throw err;
  });
  await assert.rejects(() => withRetry(a.wrapped), /denied/);
  assert.strictEqual(a.count(), 1, 'должна быть ровно одна попытка, без повтора');
});

test('постоянная 400 — без повтора', async () => {
  const err = Object.assign(new Error('bad'), { status: 400 });
  const a = attempts(async () => {
    throw err;
  });
  await assert.rejects(() => withRetry(a.wrapped));
  assert.strictEqual(a.count(), 1);
});
