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

const { isOwnContact } = require('../dist/bot/maxBot');

const SENDER = 555;

function contactAttachment(payload) {
  return [{ type: 'contact', payload }];
}

test('свой контакт принимается', () => {
  assert.strictEqual(
    isOwnContact(contactAttachment({ tam_info: { user_id: SENDER }, vcf_info: 'BEGIN:VCARD' }), SENDER),
    true
  );
});

test('чужой контакт отклоняется', () => {
  // Ровно тот случай, ради которого проверка и появилась: пользователь
  // пересылает боту карточку другого человека, чтобы получить
  // phone_verified на чужой номер.
  assert.strictEqual(
    isOwnContact(contactAttachment({ tam_info: { user_id: 999 }, vcf_info: 'BEGIN:VCARD' }), SENDER),
    false
  );
});

test('карточка без привязки к аккаунту MAX отклоняется', () => {
  // Произвольная vCard из адресной книги: подтвердить по ней нечего —
  // телефон в ней может быть чей угодно.
  assert.strictEqual(isOwnContact(contactAttachment({ vcf_info: 'BEGIN:VCARD' }), SENDER), false);
  assert.strictEqual(isOwnContact(contactAttachment({ tam_info: null, vcf_info: 'x' }), SENDER), false);
  assert.strictEqual(isOwnContact(contactAttachment({ tam_info: {} }), SENDER), false);
});

test('сравнение по user_id строгое — строка не выдаёт себя за число', () => {
  assert.strictEqual(isOwnContact(contactAttachment({ tam_info: { user_id: String(SENDER) } }), SENDER), false);
});

test('мусор на входе не роняет проверку и не проходит её', () => {
  assert.strictEqual(isOwnContact(undefined, SENDER), false);
  assert.strictEqual(isOwnContact(null, SENDER), false);
  assert.strictEqual(isOwnContact([], SENDER), false);
  assert.strictEqual(isOwnContact('не массив', SENDER), false);
  assert.strictEqual(isOwnContact([null, undefined, 42], SENDER), false);
  // Вложения других типов не должны приниматься за контакт.
  assert.strictEqual(isOwnContact([{ type: 'image', payload: { url: 'x' } }], SENDER), false);
});

test('контакт находится среди вложений других типов', () => {
  const mixed = [
    { type: 'image', payload: { url: 'x' } },
    { type: 'contact', payload: { tam_info: { user_id: SENDER } } },
  ];
  assert.strictEqual(isOwnContact(mixed, SENDER), true);
});
