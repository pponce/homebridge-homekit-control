'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const key = id => crypto.createHash('sha256').update(String(id).toUpperCase()).digest('hex');
const folder = root => path.join(root, 'homekit-control');
function write(root, kind, id, data) {
  const dir = path.join(folder(root), kind);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, key(id) + '.json');
  const temp = file + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
  try { fs.writeFileSync(temp, JSON.stringify(data, null, 2), { mode: 0o600, flag: 'wx' }); fs.renameSync(temp, file); }
  finally { try { fs.unlinkSync(temp); } catch {} }
}
function read(root, kind, id) {
  try { return JSON.parse(fs.readFileSync(path.join(folder(root), kind, key(id) + '.json'), 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return undefined; throw e; }
}
function listPairings(root) {
  const dir = path.join(folder(root), 'pairings');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => /^[a-f0-9]{64}\.json$/.test(f)).map(file => {
    const d = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    return { id: d.id, name: d.name, address: d.address, port: d.port, pairedAt: d.pairedAt };
  });
}
function resolvePairing(root, config) {
  const valid = data => data && ['AccessoryPairingID','AccessoryLTPK','iOSDevicePairingID','iOSDeviceLTSK','iOSDeviceLTPK'].every(k => typeof data[k] === 'string' && data[k].length);
  // The schema form can serialize an empty legacy credentials object.
  const data = valid(config.pairingData) ? config.pairingData : read(root, 'pairings', config.id)?.pairingData;
  if (!valid(data)) {
    throw new Error('Pairing credentials are missing. Pair or restore this device in plugin settings.');
  }
  return data;
}
// Positive allowlist: never serialize arbitrary device values or custom characteristic data.
function servicesForExport(data) {
  return (data?.accessories || []).map(a => ({ aid: a.aid, services: (a.services || []).map(s => ({
    iid: s.iid, type: s.type, primary: !!s.primary,
    characteristics: (s.characteristics || []).map(c => {
      const output = { iid: c.iid, type: c.type, perms: c.perms, format: c.format };
      for (const k of ['minValue','maxValue','minStep','unit','validValues','valid-values','validValueRanges','valid-values-range']) {
        if (c[k] !== undefined) output[k] = c[k];
      }
      return output;
    }),
  })) }));
}
module.exports = { write, read, listPairings, resolvePairing, servicesForExport };
