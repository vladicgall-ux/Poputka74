/**
 * Тесты на таблицу разрешённых переходов статусов.
 *
 * Здесь проверяется именно то, что попадает в WHERE условных UPDATE в
 * bookingService: список исходных статусов для каждого целевого. Если
 * кто-то расширит таблицу переходов, не подумав, эти тесты упадут.
 */
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

process.env.BOT_TOKEN = '123456:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'poputka-sm-test-')), 'test.db');

const {
  bookingSourcesFor,
  rideSourcesFor,
  isBookingTransitionAllowed,
  isRideTransitionAllowed,
} = require('../dist/services/statusMachine');

test('подтвердить можно только заявку в pending', () => {
  assert.deepStrictEqual(bookingSourcesFor('confirmed'), ['pending']);
  assert.strictEqual(isBookingTransitionAllowed('pending', 'confirmed'), true);
  assert.strictEqual(isBookingTransitionAllowed('cancelled', 'confirmed'), false);
  assert.strictEqual(isBookingTransitionAllowed('confirmed', 'confirmed'), false);
});

test('отменить можно и pending, и confirmed', () => {
  assert.deepStrictEqual(bookingSourcesFor('cancelled').sort(), ['confirmed', 'pending']);
});

test('отменённая бронь не оживает и не возвращается в pending', () => {
  assert.strictEqual(isBookingTransitionAllowed('cancelled', 'pending'), false);
  assert.strictEqual(isBookingTransitionAllowed('cancelled', 'confirmed'), false);
  assert.strictEqual(isBookingTransitionAllowed('confirmed', 'pending'), false);
  assert.deepStrictEqual(bookingSourcesFor('pending'), []);
});

test('поездка уходит из active в cancelled или completed, обратно — никак', () => {
  assert.deepStrictEqual(rideSourcesFor('cancelled'), ['active']);
  assert.deepStrictEqual(rideSourcesFor('completed'), ['active']);
  assert.deepStrictEqual(rideSourcesFor('active'), []);
});

test('запрещённые переходы поездки из задания', () => {
  // Ровно те случаи, которые названы в требованиях как недопустимые.
  assert.strictEqual(isRideTransitionAllowed('cancelled', 'active'), false);
  assert.strictEqual(isRideTransitionAllowed('completed', 'active'), false);
  assert.strictEqual(isBookingTransitionAllowed('pending', 'completed'), false);
});

test('неизвестный статус не открывает переход', () => {
  assert.strictEqual(isBookingTransitionAllowed('выдуманный', 'confirmed'), false);
  assert.strictEqual(isRideTransitionAllowed('выдуманный', 'active'), false);
});
