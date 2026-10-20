'use strict';
const storage = require('./storage');
const { PairingInputError } = require('./pairing-errors');
const HttpClient = require('hap-controller/lib/transport/ip/http-client').default;
const IPDiscovery = require('hap-controller/lib/transport/ip/ip-discovery').default;
function normalizePin(pin) {
  if (typeof pin !== 'string' || !/^(\d{3}-\d{2}-\d{3}|\d{4}-\d{4}|\d{8})$/.test(pin.trim())) throw new PairingInputError('Enter the eight-digit HomeKit pairing code.');
  const n = pin.trim().replace(/-/g, '');
  return `${n.slice(0,3)}-${n.slice(3,5)}-${n.slice(5)}`;
}
async function bounded(operation, client, ms = 12000) {
  let timer;
  try { return await Promise.race([operation(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Device request timed out.')), ms); })]); }
  finally { clearTimeout(timer); await client.close(); }
}
async function discover(iface, seconds = 8) {
  const discovery = new IPDiscovery(iface || undefined);
  try {
    return await new Promise((resolve, reject) => {
      const found = new Map();
      const timer = setTimeout(() => resolve([...found.values()]), seconds * 1000);
      discovery.on('serviceUp', s => found.set(s.id, s));
      discovery.on('serviceChanged', s => found.set(s.id, s));
      discovery.on('error', () => { clearTimeout(timer); reject(new Error('Network discovery failed.')); });
      try { discovery.start(); } catch (e) { clearTimeout(timer); reject(e); }
    });
  } finally { discovery.stop(); }
}
async function pair(root, service, pin, name) {
  const normalized = normalizePin(pin);
  if (!service.availableToPair) throw new PairingInputError('The device reports that it is already paired. Reuse its saved pairing, or remove its existing Apple Home pairing while it is online and discover it again.');
  const client = new HttpClient(service.id, service.address, service.port);
  return bounded(async () => {
    const method = await new IPDiscovery().getPairMethod(service);
    await client.pairSetup(normalized, method);
    // Save immediately. A later failed probe or closed settings modal must not lose the pairing.
    const data = { id: service.id, name: name || service.name, address: service.address, port: service.port,
      pairedAt: new Date().toISOString(), pairingData: client.getLongTermData() };
    storage.write(root, 'pairings', service.id, data);
    return { id: data.id, name: data.name, address: data.address, port: data.port };
  }, client, 30000);
}
async function probe(root, config) {
  const client = new HttpClient(config.id, config.address, config.port, storage.resolvePairing(root, config));
  return bounded(async () => ({ services: storage.servicesForExport(await client.getAccessories()), checkedAt: new Date().toISOString() }), client);
}
module.exports = { normalizePin, bounded, discover, pair, probe };
