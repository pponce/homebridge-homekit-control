const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
function packageInfo(entry, name) {
  let dir = path.dirname(entry);
  for (;;) {
    const file = path.join(dir, 'package.json');
    if (fs.existsSync(file)) {
      const info = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (info.name === name) return info;
    }
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error('Package metadata not found: ' + name);
    dir = parent;
  }
}
const entry = require.resolve('homebridge');
const info = packageInfo(entry, 'homebridge');
const hostRequire = createRequire(entry);
const hapName = info.dependencies['@homebridge/hap-nodejs'] ? '@homebridge/hap-nodejs' : 'hap-nodejs';
const hapEntry = hostRequire.resolve(hapName);
module.exports = {
  loadHap: () => import(pathToFileURL(hapEntry).href),
  versions: { node: process.version, homebridge: info.version, hap: packageInfo(hapEntry, hapName).version },
};
