'use strict';
const fs = require('node:fs');
const storage = require('../shared/storage');
const controller = require('../shared/controller');
const { PairingInputError, pairingMessage } = require('../shared/pairing-errors');
// UI utils 2.x is ESM; keep the runtime plugin CommonJS for existing Homebridge versions.
(async () => {
  const { HomebridgePluginUiServer, RequestError } = await import('@homebridge/plugin-ui-utils');
  class UiServer extends HomebridgePluginUiServer {
    constructor() {
      super();
      this.devices = new Map();
      this.busy = false;
      const route = (path, fn) => this.onRequest(path, async body => {
        if (this.busy) throw new RequestError('Another device operation is still running.');
        this.busy = true;
        try { return await fn(body || {}); }
        catch (e) {
          // Do not forward protocol response bodies or pairing credentials to logs/the browser.
          const message = path === '/pair' ? pairingMessage(e) : 'Could not complete the device request. Check connectivity and saved settings.';
          throw new RequestError(message);
        } finally { this.busy = false; }
      });
      route('/discover', async ({ interface: iface }) => {
        if (iface && (typeof iface !== 'string' || !/^[a-zA-Z0-9_.:-]{1,64}$/.test(iface))) throw new Error('Invalid interface');
        const devices = await controller.discover(iface);
        this.devices = new Map(devices.map(d => [d.id, d]));
        return devices.map(d => ({ id: d.id, name: d.name, address: d.address, port: d.port, availableToPair: d.availableToPair }));
      });
      route('/pair', async ({ id, pin, name }) => {
        const device = this.devices.get(id);
        if (!device) throw new PairingInputError('Discover the device first');
        if (name && (typeof name !== 'string' || name.length > 100)) throw new Error('Invalid name');
        if (storage.read(this.homebridgeStoragePath, 'pairings', id)) throw new PairingInputError('A pairing is already saved for this device. Use Add saved device or its existing settings instead of pairing it again.');
        return controller.pair(this.homebridgeStoragePath, device, pin, name);
      });
      route('/saved-pairings', async () => storage.listPairings(this.homebridgeStoragePath));
      route('/status', async () => {
        const config = this.configured();
        return config.map(d => {
          const status = storage.read(this.homebridgeStoragePath, 'status', `${d.uniquePrefix || ''}:${d.id.toUpperCase()}`);
          return { id: d.id, prefix: d.uniquePrefix || '', name: d.name, state: !status ? 'not started' :
            status.state === 'online' && Date.now() - Date.parse(status.updatedAt) > 90000 ? 'status stale' : status.state,
          lastRefreshAt: status?.lastRefreshAt, subscriptions: status?.subscriptions, nextRetryAt: status?.nextRetryAt,
          nodeVersion: status?.nodeVersion, homebridgeVersion: status?.homebridgeVersion, pluginVersion: status?.pluginVersion };
        });
      });
      route('/probe', async ({ id, prefix }) => controller.probe(this.homebridgeStoragePath, this.device(id, prefix)));
      route('/diagnostics', async ({ id, prefix }) => {
        const d = this.device(id, prefix);
        const saved = storage.read(this.homebridgeStoragePath, 'status', `${d.uniquePrefix || ''}:${d.id.toUpperCase()}`);
        const result = await controller.probe(this.homebridgeStoragePath, d);
        return { formatVersion: 1, device: { name: d.name, id: d.id }, checkedAt: result.checkedAt, services: result.services,
          runtime: saved ? { node: saved.nodeVersion, homebridge: saved.homebridgeVersion, plugin: saved.pluginVersion } : null,
          connection: saved ? { state: saved.state, lastRefreshAt: saved.lastRefreshAt, subscriptions: saved.subscriptions } : null };
      });
      this.ready();
    }
    configured() {
      const config = JSON.parse(fs.readFileSync(this.homebridgeConfigPath, 'utf8'));
      return (config.platforms || []).filter(p => p.platform === 'HomekitControl').flatMap(p => p.services || []);
    }
    device(id, prefix = '') {
      const device = this.configured().find(d => d.id === id && (d.uniquePrefix || '') === prefix);
      if (!device) throw new Error('Save this device in plugin settings first');
      const status = storage.read(this.homebridgeStoragePath, 'status', `${device.uniquePrefix || ''}:${device.id.toUpperCase()}`);
      return status?.address && status?.port ? { ...device, address: status.address, port: status.port } : device;
    }
  }
  new UiServer();
})().catch(() => { console.error('Unable to start HomeKit Control settings server.'); process.exitCode = 1; });
