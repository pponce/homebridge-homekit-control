'use strict';
// Only our own fixed guidance may be shown; never echo protocol payloads or keys.
class PairingInputError extends Error {}
function pairingMessage(error) {
  if (error instanceof PairingInputError) return error.message;
  const match = /^M[246]: Error: ([1-7])$/.exec(error?.message || '');
  const messages = {
    2: 'The accessory could not authenticate the pairing. Check its HomeKit setup code and try again.',
    3: 'The accessory requested a delay. Wait before trying to pair again.',
    4: 'The accessory cannot accept more pairings. Check its existing controller pairings before trying again.',
    5: 'The accessory has reached its pairing-attempt limit. Stop retrying and follow the manufacturer’s recovery instructions.',
    6: 'HomeKit pairing is unavailable (error 6). The device may already be paired or may not accept this pairing method. Remove its existing Apple Home pairing while it is online, or follow the manufacturer’s HomeKit pairing/reset instructions. Then discover it again. Saved Homebridge pairings should be reused instead of paired again.',
    7: 'The accessory is busy with another pairing. Close the other setup session, wait, and discover it again.',
  };
  return messages[match?.[1]] || 'Pairing did not complete. Check connectivity and pairing state, then check for a saved pairing before retrying. If the accessory paired but its keys could not be saved, a manufacturer HomeKit pairing reset may be required.';
}
module.exports = { PairingInputError, pairingMessage };
