const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const storage = require('../shared/storage');

test('real UI server starts over IPC and serves only sanitized settings data', { timeout: 10000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hkc-ui-'));
  const config = path.join(root, 'config.json');
  const device = { id: 'AA:BB', name: 'Strip', address: '192.0.2.1', port: 123, pairingData: { secret: 'DO_NOT_EXPORT' } };
  fs.writeFileSync(config, JSON.stringify({ platforms: [{ platform: 'HomekitControl', services: [device] }] }));
  storage.write(root, 'pairings', device.id, device);
  storage.write(root, 'status', ':AA:BB', { state: 'online', updatedAt: new Date().toISOString(), nodeVersion: process.version, homebridgeVersion: 'test', subscriptions: 3, secret: 'DO_NOT_EXPORT' });
  const child = fork(path.resolve('homebridge-ui/server.js'), [], {
    env: { ...process.env, HOMEBRIDGE_STORAGE_PATH: root, HOMEBRIDGE_CONFIG_PATH: config }, silent: true,
  });
  let logs = ''; child.stdout.on('data', data => { logs += data; }); child.stderr.on('data', data => { logs += data; });
  function receive(match, send) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('UI IPC timeout: ' + logs)), 4000);
      const message = value => { if (match(value)) finish(undefined, value); };
      const exit = code => finish(new Error('UI server exited: ' + code + ' ' + logs));
      function finish(error, value) { clearTimeout(timer); child.off('message', message); child.off('exit', exit); error ? reject(error) : resolve(value); }
      child.on('message', message); child.on('exit', exit); if (send) child.send(send);
    });
  }
  let next = 0;
  const request = async (endpoint, body = {}) => {
    const requestId = String(++next);
    return (await receive(m => m.action === 'response' && m.payload.requestId === requestId, { action: 'request', requestId, path: endpoint, body })).payload;
  };
  try {
    await receive(m => m.action === 'ready');
    const state = await request('/status'); assert.equal(state.success, true); assert.equal(state.data[0].state, 'online'); assert.equal(state.data[0].nodeVersion, process.version);
    const saved = await request('/saved-pairings'); assert.equal(saved.success, true); assert.equal(saved.data[0].id, 'AA:BB');
    const rejected = await request('/pair', { id: 'unknown', pin: '876-54-321' }); assert.equal(rejected.success, false);
    assert(!JSON.stringify([state, saved, rejected]).includes('DO_NOT_EXPORT'));
    assert(!logs.includes('DO_NOT_EXPORT')); assert(!logs.includes('876-54-321'));
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve)); child.kill(); await exited;
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});
