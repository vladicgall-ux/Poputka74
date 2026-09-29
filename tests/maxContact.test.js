/**
 * Проверка владения контактной карточкой в боте MAX.
 *
 * Это тот самый барьер от фейковых анкет: ctx.contactInfo в SDK — просто
 * распарсенная vCard из вложения, то есть телефон берётся из карточки,
 * которую приложил пользователь, а приложить можно любой контакт из
 * адресной книги. Владельца показывает только payload.tam_info сырого
 * вложения — эти тесты закрепляют, что мы сверяем именно его.
 */
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

process.env.BOT_TOKEN = '123456:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
process.env.MAX_BOT_TOKEN = '654321:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'poputka-max-test-')), 'test.db');

const { isForeignContact } = require('../dist/bot/maxBot');

const SENDER = 555;

function contactAttachment(payload) {
  return [{ type: 'contact', payload }];
}

// isForeignContact === true означает «отклонить»: контакт ЯВНО чужой.

test('свой номер через кнопку (vcf без tam_info) — НЕ чужой, проходит', () => {
  // Это и есть штатный путь подтверждения и причина прежней регрессии:
  // кнопка «Поделиться своим номером» присылает vcf_info без tam_info.
  assert.strictEqual(isForeignContact(contactAttachment({ vcf_info: 'BEGIN:VCARD' }), SENDER), false);
  assert.strictEqual(isForeignContact(contactAttachment({ tam_info: null, vcf_info: 'x' }), SENDER), false);
  assert.strictEqual(isForeignContact(contactAttachment({ tam_info: {} }), SENDER), false);
});

test('свой контакт с tam_info на себя — НЕ чужой, проходит', () => {
  assert.strictEqual(
    isForeignContact(contactAttachment({ tam_info: { user_id: SENDER }, vcf_info: 'BEGIN:VCARD' }), SENDER),
    false
  );
});

test('карточка другого пользователя MAX (tam_info на чужой user_id) — чужой, отклоняется', () => {
  // Единственный случай, который надёжно ловится: MAX разрешил контакт в
  // конкретного пользователя, и это не отправитель.
  assert.strictEqual(
    isForeignContact(contactAttachment({ tam_info: { user_id: 999 }, vcf_info: 'BEGIN:VCARD' }), SENDER),
    true
  );
});

test('строковый user_id не считается совпадением — но и чужим тоже (нет числа)', () => {
  // Строка не проходит проверку typeof === number, поэтому «доказательства
  // чужого» нет — контакт не отклоняется как чужой.
  assert.strictEqual(isForeignContact(contactAttachment({ tam_info: { user_id: String(SENDER) } }), SENDER), false);
});

test('мусор на входе не считается чужим контактом', () => {
  assert.strictEqual(isForeignContact(undefined, SENDER), false);
  assert.strictEqual(isForeignContact(null, SENDER), false);
  assert.strictEqual(isForeignContact([], SENDER), false);
  assert.strictEqual(isForeignContact('не массив', SENDER), false);
  assert.strictEqual(isForeignContact([null, undefined, 42], SENDER), false);
  assert.strictEqual(isForeignContact([{ type: 'image', payload: { url: 'x' } }], SENDER), false);
});

test('чужой контакт находится среди вложений других типов', () => {
  const mixed = [
    { type: 'image', payload: { url: 'x' } },
    { type: 'contact', payload: { tam_info: { user_id: 999 } } },
  ];
  assert.strictEqual(isForeignContact(mixed, SENDER), true);
});
