/**
 * Тесты на функции, от которых зависит безопасность.
 *
 * Запускаются встроенным раннером Node (node --test) по собранному коду в
 * dist/ — поэтому не тянут ни одной новой зависимости и не требуют
 * отдельной конфигурации компилятора для тестов.
 *
 * Переменные окружения выставляются ДО первого require: config.ts падает
 * без BOT_TOKEN, а db.ts при импорте сразу открывает файл базы — база для
 * тестов должна быть отдельной, временной.
 */
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const BOT_TOKEN = '123456:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
process.env.BOT_TOKEN = BOT_TOKEN;
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'poputka-test-')), 'test.db');

const { escapeTgHtml } = require('../dist/utils/escapeHtml');
const { parseId, parseSignedId } = require('../dist/server/utils/parseId');
const { displayName } = require('../dist/utils/displayName');
const { validateInitData } = require('../dist/utils/telegramAuth');

/** Собирает initData с корректной подписью — так же, как это делает Telegram. */
function signInitData(params, token = BOT_TOKEN) {
  const dataCheckString = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
  const usp = new URLSearchParams(params);
  usp.set('hash', hash);
  return usp.toString();
}

function freshUser(overrides = {}) {
  return {
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: 'AAA',
    user: JSON.stringify({ id: 777, first_name: 'Тест' }),
    ...overrides,
  };
}

test('escapeTgHtml обезвреживает теги в пользовательском тексте', () => {
  assert.strictEqual(escapeTgHtml('<b>жирный</b>'), '&lt;b&gt;жирный&lt;/b&gt;');
  // Фишинг под видом системного уведомления бота — основной риск здесь.
  assert.ok(!escapeTgHtml('<a href="http://evil">клик</a>').includes('<a'));
  // Амперсанд экранируется первым, иначе получилось бы двойное экранирование.
  assert.strictEqual(escapeTgHtml('A & B'), 'A &amp; B');
  assert.strictEqual(escapeTgHtml('обычный текст'), 'обычный текст');
});

test('parseId принимает только положительные целые', () => {
  assert.strictEqual(parseId('42'), 42);
  assert.strictEqual(parseId('0'), null);
  assert.strictEqual(parseId('-1'), null);
  assert.strictEqual(parseId('abc'), null);
  assert.strictEqual(parseId('1.5'), null);
  assert.strictEqual(parseId(''), null);
  assert.strictEqual(parseId('99999999999999999999'), null);
});

test('parseSignedId допускает отрицательные — так хранятся пользователи MAX', () => {
  assert.strictEqual(parseSignedId('42'), 42);
  assert.strictEqual(parseSignedId('-42'), -42);
  assert.strictEqual(parseSignedId('0'), null);
  assert.strictEqual(parseSignedId('abc'), null);
});

test('displayName предпочитает указанное имя имени из профиля', () => {
  assert.strictEqual(displayName('Иван Петров', 'ivan'), 'Иван Петров');
  assert.strictEqual(displayName(null, 'ivan'), 'ivan');
  assert.strictEqual(displayName('', 'ivan'), 'ivan');
});

test('validateInitData принимает корректно подписанные данные', () => {
  const result = validateInitData(signInitData(freshUser()));
  assert.ok(result, 'корректная подпись должна проходить проверку');
  assert.strictEqual(result.user.id, 777);
  assert.strictEqual(result.user.first_name, 'Тест');
});

test('validateInitData отклоняет подделку', () => {
  // Подпись чужим токеном — как если бы данные собрал кто-то посторонний.
  assert.strictEqual(validateInitData(signInitData(freshUser(), '999:WRONGTOKEN')), null);

  // Подмена полезной нагрузки при сохранённой старой подписи: подменяем
  // id пользователя на чужой — именно так выглядела бы попытка выдать
  // себя за другого.
  const signed = signInitData(freshUser());
  const tampered = new URLSearchParams(signed);
  tampered.set('user', JSON.stringify({ id: 1, first_name: 'Админ' }));
  assert.strictEqual(validateInitData(tampered.toString()), null);

  // Без подписи вовсе и на пустом входе.
  const noHash = new URLSearchParams(signed);
  noHash.delete('hash');
  assert.strictEqual(validateInitData(noHash.toString()), null);
  assert.strictEqual(validateInitData(''), null);
});

test('validateInitData следит за сроком годности auth_date', () => {
  const dayAndHourAgo = String(Math.floor(Date.now() / 1000) - 25 * 60 * 60);
  assert.strictEqual(validateInitData(signInitData(freshUser({ auth_date: dayAndHourAgo }))), null);

  // Дата из будущего: без верхней границы такие данные не устарели бы никогда.
  const farFuture = String(Math.floor(Date.now() / 1000) + 60 * 60);
  assert.strictEqual(validateInitData(signInitData(freshUser({ auth_date: farFuture }))), null);

  // Небольшое расхождение часов вперёд (в пределах 5 минут) допускается.
  const slightlyAhead = String(Math.floor(Date.now() / 1000) + 60);
  assert.ok(validateInitData(signInitData(freshUser({ auth_date: slightlyAhead }))));
});

test('validateInitData требует вменяемый объект пользователя', () => {
  assert.strictEqual(validateInitData(signInitData(freshUser({ user: 'не json' }))), null);
  // id должен быть числом, а не строкой.
  assert.strictEqual(
    validateInitData(signInitData(freshUser({ user: JSON.stringify({ id: '777', first_name: 'Тест' }) }))),
    null
  );
  // Без first_name.
  assert.strictEqual(validateInitData(signInitData(freshUser({ user: JSON.stringify({ id: 777 }) }))), null);
});
