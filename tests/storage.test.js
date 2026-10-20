const { test }=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const storage=require('../shared/storage');
test('pairing store is private and diagnostic export cannot contain secrets or arbitrary values',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hkc-'));
 try {
 storage.write(root,'pairings','../DEVICE',{id:'../DEVICE',name:'Lamp',pairingData:{iOSDeviceLTSK:'SECRET'}});
 assert.equal(storage.read(root,'pairings','../DEVICE').pairingData.iOSDeviceLTSK,'SECRET');
 const file=fs.readdirSync(path.join(root,'homekit-control','pairings'))[0];assert.equal(fs.statSync(path.join(root,'homekit-control','pairings',file)).mode&0o777,0o600);
 assert(!JSON.stringify(storage.listPairings(root)).includes('SECRET'));
 const output=storage.servicesForExport({pairingData:'SECRET',accessories:[{aid:1,secret:'SECRET',services:[{iid:3,type:'43',characteristics:[{iid:4,type:'23',value:'SECRET',description:'SECRET',perms:['pr']}]}]}]});
 assert(!JSON.stringify(output).includes('SECRET'));assert.equal(output[0].services[0].characteristics[0].iid,4);
 } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('empty schema credentials fall back to private storage; complete legacy credentials still work',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hkc-'));
 const keys=Object.fromEntries(['AccessoryPairingID','AccessoryLTPK','iOSDevicePairingID','iOSDeviceLTSK','iOSDeviceLTPK'].map(k=>[k,'saved']));
 try {
 storage.write(root,'pairings','device',{id:'device',pairingData:keys});
 assert.deepEqual(storage.resolvePairing(root,{id:'device',pairingData:{}}),keys);
 assert.deepEqual(storage.resolvePairing(root,{id:'device',pairingData:{iOSDeviceLTSK:''}}),keys);
 const legacy={...keys,iOSDeviceLTSK:'legacy'};assert.deepEqual(storage.resolvePairing(root,{id:'device',pairingData:legacy}),legacy);
 assert.throws(()=>storage.resolvePairing(root,{id:'missing',pairingData:{}}),/missing/);
 } finally {fs.rmSync(root,{recursive:true,force:true});}
});
