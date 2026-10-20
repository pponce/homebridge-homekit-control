const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PairingInputError, pairingMessage } = require('../shared/pairing-errors');
test('pairing refusals explain device state without leaking raw error data', () => {
  assert.match(pairingMessage(new Error('M2: Error: 6')), /pairing is unavailable/);
  assert.match(pairingMessage(new Error('M4: Error: 2')), /authenticate/);
  assert.match(pairingMessage(new Error('M2: Error: 5')), /Stop retrying/);
  assert.match(pairingMessage(new Error('M2: Error: 7')), /busy/);
  assert.equal(pairingMessage(new PairingInputError('Discover the device first')), 'Discover the device first');
  for (const error of [new Error('SECRET_PAIRING_KEY'), { message: 'M2: Error: 6 SECRET_PAIRING_KEY' }, { body: 'SECRET_PAIRING_KEY' }]) {
    assert(!pairingMessage(error).includes('SECRET_PAIRING_KEY'));
  }
});
