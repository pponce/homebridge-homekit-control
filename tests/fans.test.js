const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { HKClient } = require('../dist/HKClient');
const { SupportedServices } = require('../dist/SupportedDevices');

let hap;
before(async () => { hap = await require('./helpers/host').loadHap(); });

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hkc-fan-test-'));
  const api = new EventEmitter();
  api.hap = hap;
  api.user = { storagePath: () => root };
  api.serverVersion = 'test';
  api.platformAccessory = class extends hap.Accessory {
    constructor(...args) { super(...args); this.context = {}; }
  };
  api.registerPlatformAccessories = () => {};
  api.updatePlatformAccessories = () => {};
  const log = () => {};
  for (const level of ['info', 'warn', 'debug', 'error']) log[level] = () => {};
  const parent = { api, log, accessories: [], supported: new SupportedServices(api), clientFinishedLaunching() {} };
  const config = { id: 'AA:BB:CC:DD:EE:FF', name: 'Ceiling fan', address: '127.0.0.1', port: 123, pairingData: {}, proxyAll: false };
  const watchers = new Map();
  const writes = [];
  const transport = {
    watch: (c, callback) => watchers.set(c.cname, callback),
    clearWatchers: () => watchers.clear(),
    setCharacteristics: async values => { writes.push(values); },
    unsubscribeAll: async () => {},
    shutdown: async () => {},
  };
  const client = new HKClient(config, parent, async () => []);
  client.client = transport;
  const f = {
    client, parent, config, transport, watchers, writes,
    load(data) {
      f.client._loadDevices(data);
      f.client.loadOrCreate(f.client.supportedAccessories[0], true);
      f.client.online = true;
      return parent.accessories[0];
    },
    async cleanup() {
      await f.client.shutdown();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
  return f;
}

function characteristic(iid, name, value, extra = {}) {
  return { iid, type: hap.Characteristic[name].UUID, value, format: 'uint8', perms: ['pr', 'pw', 'ev'], ...extra };
}

function fanDatabase(kind, { minimal = false, modes = false } = {}) {
  const characteristics = [
    characteristic(11, 'Name', 'Ceiling', { format: 'string', perms: ['pr'] }),
    characteristic(12, kind === 'Fan' ? 'On' : 'Active', kind === 'Fan' ? false : 0,
      { format: kind === 'Fan' ? 'bool' : 'uint8' }),
  ];
  if (!minimal) characteristics.push(
    characteristic(13, 'RotationSpeed', 25, { format: 'float', unit: 'percentage', minValue: 0, maxValue: 100, minStep: 25 }),
    characteristic(14, 'RotationDirection', 0, { format: 'int', minValue: 0, maxValue: 1, 'valid-values': [0, 1] }),
  );
  if (modes) characteristics.push(
    characteristic(15, 'CurrentFanState', 1, { perms: ['pr', 'ev'] }),
    characteristic(16, 'TargetFanState', 0, { 'valid-values': [0] }),
    characteristic(17, 'SwingMode', 0),
    characteristic(18, 'LockPhysicalControls', 0),
  );
  return { accessories: [{ aid: 1, services: [
    // Exercise short-form legacy and full-form modern service UUIDs.
    { iid: 10, type: kind === 'Fan' ? '40' : hap.Service.Fanv2.UUID, characteristics },
    { iid: 20, type: '43', characteristics: [
      characteristic(21, 'Name', 'Ceiling', { format: 'string', perms: ['pr'] }),
      characteristic(22, 'On', false, { format: 'bool' }),
      characteristic(23, 'Brightness', 50, { format: 'int', minValue: 0, maxValue: 100, minStep: 1 }),
    ] },
  ] }] };
}

for (const kind of ['Fan', 'Fanv2']) {
  test(`${kind}: same-name fan and light have independent power, speed and direction commands`, async () => {
    const f = fixture();
    try {
      const accessory = f.load(fanDatabase(kind));
      const fan = accessory.getService(hap.Service[kind]);
      const light = accessory.getService(hap.Service.Lightbulb);
      assert(fan);
      assert(light);
      assert.notEqual(fan.subtype, light.subtype);
      const power = kind === 'Fan' ? hap.Characteristic.On : hap.Characteristic.Active;
      const speed = fan.getCharacteristic(hap.Characteristic.RotationSpeed);
      assert.equal(speed.props.minValue, 0);
      assert.equal(speed.props.maxValue, 100);
      assert.equal(speed.props.minStep, 25);
      await fan.getCharacteristic(power).handleSetRequest(kind === 'Fan' ? true : 1);
      await speed.handleSetRequest(75);
      await fan.getCharacteristic(hap.Characteristic.RotationDirection).handleSetRequest(1);
      assert.equal(light.getCharacteristic(hap.Characteristic.On).value, false);
      await light.getCharacteristic(hap.Characteristic.On).handleSetRequest(true);
      await light.getCharacteristic(hap.Characteristic.Brightness).handleSetRequest(40);
      assert.deepEqual(f.writes, [
        { '1.12': kind === 'Fan' ? true : 1 }, { '1.13': 75 }, { '1.14': 1 }, { '1.22': true }, { '1.23': 40 },
      ]);
      f.watchers.get('1.13')({ value: 50 });
      assert.equal(speed.value, 50);
      assert.equal(light.getCharacteristic(hap.Characteristic.Brightness).value, 40);
    } finally { await f.cleanup(); }
  });

  test(`${kind}: power-only devices do not gain unsupported optional controls`, async () => {
    const f = fixture();
    try {
      const fan = f.load(fanDatabase(kind, { minimal: true })).getService(hap.Service[kind]);
      assert(fan);
      for (const name of ['RotationSpeed', 'RotationDirection', 'CurrentFanState', 'TargetFanState', 'SwingMode', 'LockPhysicalControls']) {
        assert.equal(fan.characteristics.some(c => c.UUID === hap.Characteristic[name].UUID), false, name);
      }
    } finally { await f.cleanup(); }
  });
}

test('Fanv2 retains source modes/permissions and reports failed writes without changing state', async () => {
  const f = fixture();
  try {
    const fan = f.load(fanDatabase('Fanv2', { modes: true })).getService(hap.Service.Fanv2);
    const current = fan.getCharacteristic(hap.Characteristic.CurrentFanState);
    const target = fan.getCharacteristic(hap.Characteristic.TargetFanState);
    assert.deepEqual(current.props.perms, ['pr', 'ev']);
    assert.deepEqual(target.props.validValues, [0]);
    assert.equal(current.setHandler, undefined);
    await assert.rejects(target.handleSetRequest(1));
    assert.equal(f.writes.length, 0);
    await fan.getCharacteristic(hap.Characteristic.SwingMode).handleSetRequest(1);
    await fan.getCharacteristic(hap.Characteristic.LockPhysicalControls).handleSetRequest(1);
    await target.handleSetRequest(0);
    assert.deepEqual(f.writes, [{ '1.17': 1 }, { '1.18': 1 }, { '1.16': 0 }]);
    f.watchers.get('1.15')({ value: 2 });
    assert.equal(current.value, 2);
    f.transport.setCharacteristics = async () => { throw new Error('Device rejected command'); };
    const speed = fan.getCharacteristic(hap.Characteristic.RotationSpeed);
    const direction = fan.getCharacteristic(hap.Characteristic.RotationDirection);
    await assert.rejects(speed.handleSetRequest(75));
    await assert.rejects(direction.handleSetRequest(1));
    assert.equal(speed.value, 25);
    assert.equal(direction.value, 0);
    assert.equal(f.client.supportedAccessories[0].services[0].characteristics.find(c => c.iid === 13).value, 25);
  } finally { await f.cleanup(); }
});

test('fan/light identities survive cached restart and recovery restores state and notifications', async () => {
  const f = fixture();
  try {
    const data = fanDatabase('Fanv2');
    let subscriptions = [];
    f.transport.getAccessories = async () => structuredClone(data);
    f.transport.getCharacteristics = async ids => ({ characteristics: ids.map(id => {
      const [aid, iid] = id.split('.').map(Number);
      const c = data.accessories.find(a => a.aid === aid).services.flatMap(s => s.characteristics).find(c => c.iid === iid);
      return { aid, iid, value: c.value };
    }) });
    f.transport.subscribeCharacteristics = async ids => { subscriptions = ids; };
    await f.client.recover();
    assert.equal(f.client.online, true);
    const original = f.parent.accessories[0];
    const subtypes = original.services.map(s => [s.UUID, s.subtype]);
    const restored = hap.Accessory.deserialize(hap.Accessory.serialize(original));
    restored.context = structuredClone(original.context);
    await f.client.shutdown();
    f.parent.accessories = [restored];
    f.watchers.clear();
    f.client = new HKClient(f.config, f.parent, async () => []);
    f.client.client = f.transport;
    await f.client.recover();
    assert.equal(f.parent.accessories.length, 1);
    assert.equal(f.parent.accessories[0].UUID, original.UUID);
    assert.deepEqual(restored.services.map(s => [s.UUID, s.subtype]), subtypes);
    f.client.disconnected();
    clearTimeout(f.client.retry);
    f.client.retry = undefined;
    subscriptions = [];
    data.accessories[0].services[0].characteristics.find(c => c.iid === 13).value = 75;
    await f.client.recover();
    assert.equal(f.client.online, true);
    assert.deepEqual(subscriptions, ['1.12', '1.13', '1.14', '1.22', '1.23']);
    const speed = restored.getService(hap.Service.Fanv2).getCharacteristic(hap.Characteristic.RotationSpeed);
    assert.equal(speed.value, 75);
    f.watchers.get('1.13')({ value: 50 });
    assert.equal(speed.value, 50);
    assert.deepEqual(f.writes, []);
  } finally { await f.cleanup(); }
});
