/* global homebridge */
(async () => {
  const $ = id => document.getElementById(id);
  const message = text => { $('message').textContent = text; };
  let discovered = [];
  let busy = false;
  async function operation(fn) {
    if (busy) return;
    busy = true;
    const buttons = [...document.querySelectorAll('button')];
    const disabled = buttons.map(b => b.disabled);
    buttons.forEach(b => { b.disabled = true; });
    try { await fn(); } catch (e) { message(e.message || 'Request failed.'); }
    finally { buttons.forEach((b,i) => { b.disabled = disabled[i]; }); busy = false; updateSelection(); }
  }
  function updateSelection() {
    const d = discovered.find(d => d.id === $('devices').value);
    $('pair').disabled = busy || !d || !d.availableToPair;
  }
  async function addConfig(device) {
    const blocks = await homebridge.getPluginConfig();
    if (!blocks.length) blocks.push({ platform: 'HomekitControl', name: 'HomeKit Control', services: [] });
    const block = blocks.find(b => b.platform === 'HomekitControl') || blocks[0];
    block.services ||= [];
    if (!block.services.some(d => d.id === device.id)) block.services.push({ id: device.id, name: device.name, address: device.address, port: device.port });
    await homebridge.updatePluginConfig(blocks);
    await homebridge.savePluginConfig();
  }
  async function savedPairings() {
    const pairs = await homebridge.request('/saved-pairings');
    const blocks = await homebridge.getPluginConfig();
    const ids = blocks.flatMap(b => b.services || []).map(d => d.id);
    $('pending').replaceChildren();
    for (const pair of pairs.filter(p => !ids.includes(p.id))) {
      const row = document.createElement('div');
      const text = document.createElement('span'); text.textContent = `Saved pairing: ${pair.name} `;
      const button = document.createElement('button'); button.className = 'btn btn-secondary'; button.textContent = 'Add saved device';
      button.onclick = () => operation(async () => { await addConfig(pair); await savedPairings(); await status(); message('Saved. Restart Homebridge to connect.'); });
      row.append(text,button); $('pending').append(row);
    }
  }
  async function status() {
    const devices = await homebridge.request('/status');
    $('status').replaceChildren();
    if (!devices.length) $('status').textContent = 'No saved devices yet.';
    for (const device of devices) {
      const row = document.createElement('div'); row.className = 'device';
      const label = document.createElement('strong'); label.textContent = `${device.name || device.id}: ${device.state}`;
      const detail = document.createElement('small'); detail.textContent = `Last refresh: ${device.lastRefreshAt || 'not available'} · Subscriptions: ${device.subscriptions ?? 'not available'}`;
      const versions = document.createElement('small'); versions.textContent = `Node ${device.nodeVersion || 'unknown'} · Homebridge ${device.homebridgeVersion || 'unknown'}`;
      const probe = document.createElement('button'); probe.className = 'btn btn-secondary'; probe.textContent = 'Test connection';
      probe.onclick = () => operation(async () => { await homebridge.request('/probe',device); message(`${device.name || device.id}: the device responded. This checks a new connection, not the running plugin’s event subscriptions.`); });
      const download = document.createElement('button'); download.className = 'btn btn-secondary'; download.textContent = 'Download diagnostics';
      download.onclick = () => operation(async () => {
        const data = await homebridge.request('/diagnostics',device);
        const url = URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
        const a = document.createElement('a'); a.href=url; a.download='homekit-control-diagnostics.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
        message('Diagnostics downloaded. Pairing keys, PINs, and characteristic values are excluded. Device names and IDs are included.');
      });
      row.append(label,detail,versions,probe,download); $('status').append(row);
    }
  }
  $('discover').onclick = () => operation(async () => {
    message('Discovering devices…');
    discovered = await homebridge.request('/discover',{interface:$('interface').value.trim()});
    $('devices').replaceChildren(new Option('Select a device',''));
    discovered.forEach(d => $('devices').add(new Option(`${d.name} — ${d.address} (${d.availableToPair ? 'available' : 'already paired'})`,d.id)));
    message(discovered.length ? 'Choose an available device to pair.' : 'No devices found. Check the network interface and that the strip or thermostat is connected to Wi-Fi.');
  });
  $('devices').onchange = () => { const d=discovered.find(d=>d.id===$('devices').value); $('name').value=d?.name||''; updateSelection(); };
  $('pair').onclick = () => operation(async () => {
    const pin=$('pin').value; $('pin').value='';
    const device = await homebridge.request('/pair',{id:$('devices').value,pin,name:$('name').value.trim()});
    const selected = discovered.find(d => d.id === device.id);
    if (selected) selected.availableToPair = false;
    try { await addConfig(device); message('Paired and saved. Restart Homebridge to connect.'); }
    catch { message('Pairing is saved on the server, but configuration could not be saved. Click “Save settings” to retry, or reopen settings and use “Add saved device”.'); }
    await savedPairings(); await status();
  });
  $('refresh').onclick=()=>operation(status);
  let showing=false;
  $('settings').onclick=()=>{ showing=!showing; if(showing)homebridge.showSchemaForm();else homebridge.hideSchemaForm(); $('settings').textContent=showing?'Hide device settings':'Show device settings'; };
  $('save').onclick=()=>operation(async()=>{ const blocks=await homebridge.getPluginConfig();await homebridge.updatePluginConfig(blocks);await homebridge.savePluginConfig();message('Settings saved. Restart Homebridge to apply changes.');await status(); });
  homebridge.enableSaveButton();
  await operation(async()=>{ await savedPairings(); await status(); });
})();
