const {test}=require('node:test');const assert=require('node:assert/strict');const {EventEmitter}=require('node:events');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const hap=require('hap-nodejs');const {HKClient}=require('../dist/HKClient');const {SupportedServices}=require('../dist/SupportedDevices');
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hkc-test-'));
 const api=new EventEmitter();api.hap=hap;api.user={storagePath:()=>root};api.serverVersion='test';
 api.platformAccessory=class extends hap.Accessory {constructor(...args){super(...args);this.context={};}};
 api.registerPlatformAccessories=()=>{};api.updatePlatformAccessories=()=>{};
 const log=()=>{};for(const level of ['info','warn','debug','error'])log[level]=()=>{};
 const parent={api,log,accessories:[],supported:new SupportedServices(api),clientFinishedLaunching(){}};
 const config={id:'AA:BB:CC:DD:EE:FF',name:'Strip',address:'127.0.0.1',port:123,pairingData:{}};
 const client=new HKClient(config,parent);
 client.client={watch(){},async shutdown(){},queueLength:0,subscriptionCount:0};
 return {client,parent,config,cleanup:async()=>{await client.shutdown();fs.rmSync(root,{recursive:true,force:true});}};
}
const char=(iid,type,value,extra={})=>({iid,type,value,perms:['pr','pw','ev'],format:'bool',...extra});
const outlet=(iid,name)=>({iid,type:'47',characteristics:[char(iid+1,'23',name,{perms:['pr'],format:'string'}),char(iid+2,'25',false),char(iid+3,'26',false,{perms:['pr']})]});
test('three identically named outlets retain independent identities and writes',async()=>{
 const f=fixture();try{
 f.client._loadDevices({accessories:[{aid:1,services:[outlet(10,'Outlet'),outlet(20,'Outlet'),outlet(30,'Outlet')]}]});
 f.client.loadOrCreate(f.client.supportedAccessories[0],true); f.client.online=true;
 const a=f.parent.accessories[0];const outlets=a.services.filter(s=>s.UUID===hap.Service.Outlet.UUID);
 assert.equal(outlets.length,3);assert.equal(new Set(outlets.map(s=>s.subtype)).size,3);
 const writes=[];f.client.client.setCharacteristics=async v=>writes.push(v);
 for(const s of outlets)await s.getCharacteristic(hap.Characteristic.On).handleSetRequest(true);
 assert.deepEqual(writes,[{'1.12':true},{'1.22':true},{'1.32':true}]);
 }finally{await f.cleanup();}
});
test('cached accessory and legacy outlet subtype survive migration and rename',async()=>{
 const f=fixture();try{
 const a=new f.parent.api.platformAccessory('Strip',hap.uuid.generate('Strip'));
 a.addService(new hap.Service.Outlet('outlet1','outlet1'));f.parent.accessories.push(a);
 f.client._loadDevices({accessories:[{aid:1,services:[outlet(10,'outlet1'),outlet(20,'outlet2')]}]});
 f.client.loadOrCreate(f.client.supportedAccessories[0],true);const original=a.UUID;
 assert.equal(a.services.find(s=>s.UUID===hap.Service.Outlet.UUID).subtype,'outlet1');
 const newer=new HKClient({...f.config,name:'Renamed strip'},f.parent);newer.client=f.client.client;
 newer._loadDevices({accessories:[{aid:1,services:[outlet(10,'Renamed socket'),outlet(20,'outlet2')]}]});
 newer.loadOrCreate(newer.supportedAccessories[0],true);
 assert.equal(f.parent.accessories.length,1);assert.equal(a.UUID,original);assert.equal(a.displayName,'Renamed strip');
 assert.equal(a.services.filter(s=>s.UUID===hap.Service.Outlet.UUID).length,2);await newer.shutdown();
 }finally{await f.cleanup();}
});
test('thermostat keeps heat-only modes and temperature limits; failed writes reject',async()=>{
 const f=fixture();try{
 const services=[{iid:10,type:'4A',characteristics:[
 char(11,'11',0,{format:'uint8','valid-values':[0,1],minValue:0,maxValue:1}),
 char(12,'33',1,{format:'uint8','valid-values':[0,1],minValue:0,maxValue:1}),
 char(13,'F',20,{format:'float',perms:['pr','ev'],minValue:0,maxValue:100}),
 char(14,'35',22,{format:'float',minValue:5,maxValue:35,minStep:0.5}),
 char(15,'36',0,{format:'uint8',minValue:0,maxValue:1})]}];
 f.client._loadDevices({accessories:[{aid:1,services}]});f.client.loadOrCreate(f.client.supportedAccessories[0],true);f.client.online=true;
 const thermostat=f.parent.accessories[0].getService(hap.Service.Thermostat);
 assert(thermostat);assert.deepEqual(thermostat.getCharacteristic(hap.Characteristic.TargetHeatingCoolingState).props.validValues,[0,1]);
 const target=thermostat.getCharacteristic(hap.Characteristic.TargetTemperature);assert.equal(target.props.minValue,5);assert.equal(target.props.maxValue,35);assert.equal(target.props.minStep,0.5);
 f.client.client.setCharacteristics=async()=>{throw new Error('offline');};
 await assert.rejects(target.handleSetRequest(23));assert.equal(f.client.supportedAccessories[0].services[0].characteristics.find(c=>c.iid===14).value,22);
 }finally{await f.cleanup();}
});
test('write completion is awaited before acknowledging success',async()=>{
 const f=fixture();try{
 f.client._loadDevices({accessories:[{aid:1,services:[outlet(10,'Outlet')]}]});f.client.loadOrCreate(f.client.supportedAccessories[0],true);f.client.online=true;
 let finish;f.client.client.setCharacteristics=()=>new Promise(r=>{finish=r;});let done=false;
 const c=f.parent.accessories[0].getService(hap.Service.Outlet).getCharacteristic(hap.Characteristic.On);
 const p=c.handleSetRequest(true).then(()=>{done=true;});await new Promise(r=>setImmediate(r));assert.equal(done,false);finish();await p;assert.equal(done,true);
 }finally{await f.cleanup();}
});
test('offline startup retries, restores notifications and refreshes state',async()=>{
 const f=fixture();try{
 let attempts=0,notify=[];
 const data={accessories:[{aid:1,services:[outlet(10,'Outlet')]}]};
 f.client.client={getAccessories:async()=>{if(++attempts===1)throw new Error('offline');return data;},
 unsubscribeAll:async()=>{},clearWatchers(){},watch(){},getCharacteristics:async ids=>({characteristics:ids.map(id=>{const [aid,iid]=id.split('.').map(Number);return {aid,iid,value:iid===11?'Outlet':true};})}),
 subscribeCharacteristics:async ids=>{notify=ids;},shutdown:async()=>{}};
 await f.client.recover();assert.equal(f.client.online,false);assert(f.client.retry);assert.equal(f.client.didFinishStartup,true);
 clearTimeout(f.client.retry);f.client.retry=undefined;await f.client.recover();assert.equal(f.client.online,true);assert.deepEqual(notify,['1.12']);
 assert.equal(f.parent.accessories[0].getService(hap.Service.Outlet).getCharacteristic(hap.Characteristic.On).value,true);
 f.client.disconnected();assert.equal(f.client.online,false);assert(f.client.retry);
 }finally{await f.cleanup();}
});
