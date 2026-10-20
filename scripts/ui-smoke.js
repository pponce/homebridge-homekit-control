'use strict';
const { chromium }=require('playwright');const fs=require('node:fs');const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true});
 try {
 const page=await browser.newPage({viewport:{width:850,height:1100}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent(fs.readFileSync('homebridge-ui/public/index.html','utf8').replace('<script src="app.js"></script>',''));
 await page.evaluate(()=>{
  window.fixture={configs:[],saved:[],requests:[],failSave:false};
  window.homebridge={
   getPluginConfig:async()=>structuredClone(fixture.configs),updatePluginConfig:async c=>{fixture.configs=structuredClone(c);},
   savePluginConfig:async()=>{if(fixture.failSave)throw new Error('Save failed');},enableSaveButton(){},showSchemaForm(){},hideSchemaForm(){},
   request:async(path,body)=>{
    fixture.requests.push({path,body});
    if(path==='/saved-pairings')return fixture.saved;
    if(path==='/discover')return [{id:'one',name:'Three outlets',address:'192.0.2.1',port:123,availableToPair:true},{id:'two',name:'Already paired',address:'192.0.2.2',port:123,availableToPair:false}];
    if(path==='/status')return fixture.configs.flatMap(b=>b.services||[]).map(d=>({...d,state:'online',subscriptions:3}));
    if(path==='/pair'){const d={id:body.id,name:body.name,address:'192.0.2.1',port:123};fixture.saved.push(d);return d;}
    if(path==='/probe')return {checkedAt:new Date().toISOString()};
    if(path==='/diagnostics')return {services:[],runtime:{node:'test'}};
   }
  };
 });
 await page.addScriptTag({path:'homebridge-ui/public/app.js'});
 await page.getByRole('button',{name:'Discover devices',exact:true}).click();
 await page.selectOption('#devices','two');assert.equal(await page.locator('#pair').isDisabled(),true);
 await page.selectOption('#devices','one');assert.equal(await page.locator('#pair').isEnabled(),true);
 await page.fill('#pin','123-45-678');await page.click('#pair');
 await page.waitForFunction(()=>document.getElementById('message').textContent.includes('Paired and saved'));
 assert.equal(await page.inputValue('#pin'),'');
 const cfg=await page.evaluate(()=>fixture.configs[0].services[0]);assert.equal(cfg.id,'one');assert(!('pin' in cfg));assert(!('pairingData' in cfg));
 await page.getByRole('button',{name:'Test connection',exact:true}).click();
 await page.waitForFunction(()=>document.getElementById('message').textContent.includes('responded'));
 await page.click('#save');await page.waitForFunction(()=>document.getElementById('message').textContent.includes('Settings saved'));
 // Duplicate devices remain a single config entry even if the pairing response is retried.
 assert.equal(await page.evaluate(()=>fixture.configs[0].services.length),1);
 // A successful pairing survives a subsequent Homebridge config-save failure.
 await page.evaluate(()=>{fixture.configs=[];fixture.saved=[];fixture.failSave=true;});
 await page.click('#discover');await page.selectOption('#devices','one');
 await page.fill('#pin','123-45-678');await page.click('#pair');
 await page.waitForFunction(()=>document.getElementById('message').textContent.includes('could not be saved'));
 assert.equal(await page.evaluate(()=>fixture.saved.length),1);
 assert.equal(await page.locator('#pair').isDisabled(),true);
 await page.evaluate(()=>{fixture.failSave=false;});
 await page.click('#save');await page.waitForFunction(()=>document.getElementById('message').textContent.includes('Settings saved'));
 assert.equal(await page.evaluate(()=>fixture.configs[0].services.length),1);
 assert.deepEqual(errors,[]);console.log('Pairing UI: discovery, pairing state, save, probe and credential omission passed.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
