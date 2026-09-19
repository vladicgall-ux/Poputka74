/**
 * Тесты строгого разбора initData: размер, кодировка, обязательные поля,
 * дубликаты security-критичных параметров и окно годности auth_date.
 *
 * Парсер работает до вычисления HMAC, поэтому подпись здесь не нужна —
 * проверяется именно структурный отсев.
 */
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

process.env.BOT_TOKEN = '123456:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'poputka-parser-test-')), 'test.db');

const { parseInitData, INIT_DATA_MAX_LENGTH, CLOCK_SKEW_SEC } = require('../dist/utils/initDataParser');

const HOUR = 3600;
const VALID_HASH = 'a'.repeat(64);

function now() {
  return Math.floor(Date.now() / 1000);
}

function build(overrides = {}) {
  const fields = {
    auth_date: String(now()),
    user: JSON.stringify({ id: 777, first_name: 'Тест' }),
    hash: VALID_HASH,
    ...overrides,
  };
  return Object.entries(fields)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

test('корректная initData разбирается', () => {
  const r = parseInitData(build(), HOUR);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.hash, VALID_HASH);
  assert.ok(r.dataCheckString.includes('auth_date='));
  // hash не должен попадать в строку, по которой считается подпись.
  assert.ok(!r.dataCheckString.includes('hash='));
});

test('data-check-string отсортирована по ключу', () => {
  const r = parseInitData(build({ query_id: 'AAA', chat_type: 'private' }), HOUR);
  assert.strictEqual(r.ok, true);
  const keys = r.dataCheckString.split('\n').map((l) => l.slice(0, l.indexOf('=')));
  assert.deepStrictEqual(keys, [...keys].sort());
});

test('пустой и не-строковый вход отклоняются', () => {
  for (const bad of ['', null, undefined, 42, {}, []]) {
    assert.strictEqual(parseInitData(bad, HOUR).ok, false);
  }
});

test('слишком длинная initData отклоняется', () => {
  const huge = build({ user: JSON.stringify({ id: 777, first_name: 'x'.repeat(INIT_DATA_MAX_LENGTH) }) });
  assert.ok(huge.length > INIT_DATA_MAX_LENGTH);
  const r = parseInitData(huge, HOUR);
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /длинн/);
});

test('дубликат security-критичного параметра отклоняется', () => {
  for (const key of ['hash', 'auth_date', 'user', 'signature']) {
    // Базовая строка должна СОДЕРЖАТЬ этот параметр, иначе приписанный
    // ниже окажется первым вхождением, а не дубликатом. hash/auth_date/
    // user есть в build() по умолчанию, signature добавляем явно.
    const base = key === 'signature' ? build({ signature: 'первое' }) : build();
    const doubled = `${base}&${key}=${encodeURIComponent('второе значение')}`;
    const r = parseInitData(doubled, HOUR);
    assert.strictEqual(r.ok, false, `дубликат ${key} должен отклоняться`);
    assert.match(r.reason, /дубликат/);
  }
});

test('дубликат несекьюрного параметра допустим', () => {
  // Ограничение намеренно точечное: ломать разбор на любом повторе
  // незачем, важны только те поля, от которых зависит решение о доступе.
  const r = parseInitData(`${build()}&chat_type=private&chat_type=group`, HOUR);
  assert.strictEqual(r.ok, true);
});

test('битая процентная кодировка отклоняется', () => {
  const r = parseInitData('auth_date=%zz&user=x&hash=' + VALID_HASH, HOUR);
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /кодировк/);
});

test('пара без знака равенства и с пустым именем отклоняется', () => {
  assert.strictEqual(parseInitData('простоТекст', HOUR).ok, false);
  assert.strictEqual(parseInitData('=значение&hash=' + VALID_HASH, HOUR).ok, false);
});

test('обязательные поля', () => {
  assert.match(parseInitData(build({ hash: undefined }), HOUR).reason, /нет hash/);
  assert.match(parseInitData(build({ auth_date: undefined }), HOUR).reason, /нет auth_date/);
  assert.match(parseInitData(build({ user: undefined }), HOUR).reason, /нет user/);
});

test('hash должен быть 64 hex-символами', () => {
  for (const bad of ['короткий', 'z'.repeat(64), 'a'.repeat(63), 'a'.repeat(65)]) {
    const r = parseInitData(build({ hash: bad }), HOUR);
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /hash неверного формата/);
  }
});

test('auth_date должен быть числом разумного вида', () => {
  for (const bad of ['вчера', '-100', '1.5', '', '12345678901']) {
    assert.strictEqual(parseInitData(build({ auth_date: bad }), HOUR).ok, false);
  }
});

test('окно годности: старое отклоняется, свежее проходит', () => {
  const old = String(now() - HOUR - 60);
  const r = parseInitData(build({ auth_date: old }), HOUR);
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /просрочен/);

  // Ровно в окне — ещё принимается.
  assert.strictEqual(parseInitData(build({ auth_date: String(now() - HOUR + 60) }), HOUR).ok, true);
});

test('окно сузилось: то, что проходило при 24 часах, теперь отклоняется', () => {
  // Смысл изменения P1: initData двухчасовой давности раньше открывала
  // доступ, теперь нет.
  const twoHoursAgo = String(now() - 2 * HOUR);
  assert.strictEqual(parseInitData(build({ auth_date: twoHoursAgo }), 24 * HOUR).ok, true);
  assert.strictEqual(parseInitData(build({ auth_date: twoHoursAgo }), HOUR).ok, false);
});

test('дата из будущего отклоняется, небольшое расхождение часов допускается', () => {
  const farFuture = String(now() + CLOCK_SKEW_SEC + 120);
  const r = parseInitData(build({ auth_date: farFuture }), HOUR);
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /будущ/);

  assert.strictEqual(parseInitData(build({ auth_date: String(now() + 60) }), HOUR).ok, true);
});
