const {test}=require('node:test');const assert=require('node:assert/strict');const {EventEmitter}=require('node:events');
const {HttpWrapper}=require('../dist/HttpWrapper');
const log={debug(){},info(){},warn(){},error(){}};
class Client extends EventEmitter {
  static clients=[];
  constructor(){super();this.subs=[];this.closed=false;Client.clients.push(this);}
  async getAccessories(){return {accessories:[]};}
  async subscribeCharacteristics(ids){this.subs.push(...ids);return null;}
  async unsubscribeCharacteristics(ids){this.unsubscribed=ids;return null;}
  async close(){this.closed=true;}
}
test('event disconnect replaces transport and allows subscriptions to be restored',async()=>{
  const w=new HttpWrapper(log,'id','127.0.0.1',123,{},50,Client);
  let loss=0,events=0;w.on('disconnected',()=>loss++);w.watch({cname:'1.10'},()=>events++);
  await w.subscribeCharacteristics(['1.10']); const old=w.client;
  old.emit('event-disconnect',['1.10']);await new Promise(r=>setImmediate(r));
  assert.equal(loss,1);assert.equal(old.closed,true);assert.notEqual(w.client,old);
  await w.subscribeCharacteristics(['1.10']);w.client.emit('event',{characteristics:[{aid:1,iid:10,value:true}]});
  assert.equal(events,1);assert.equal(w.subscriptionCount,1);
  const current=w.client;await w.shutdown();assert.deepEqual(current.unsubscribed,['1.10']);assert.equal(current.closed,true);
});
test('rejected subscriptions discard the transport cache before retrying',async()=>{
  const w=new HttpWrapper(log,'id','127.0.0.1',123,{},50,Client);
  const old=w.client;old.subscribeCharacteristics=async()=>({characteristics:[{status:-70406}]});
  await assert.rejects(w.subscribeCharacteristics(['1.10']));
  assert.equal(old.closed,true);assert.notEqual(w.client,old);assert.equal(w.subscriptionCount,0);
  await w.subscribeCharacteristics(['1.10']);assert.equal(w.subscriptionCount,1);await w.shutdown();
});
test('late subscription response cannot mutate a replacement transport',async()=>{
  const w=new HttpWrapper(log,'id','127.0.0.1',123,{},20,Client);
  let finish;w.client.subscribeCharacteristics=()=>new Promise(r=>{finish=r;});
  await assert.rejects(w.subscribeCharacteristics(['1.10']),/timed out/);
  await w.subscribeCharacteristics(['1.20']);finish(null);await new Promise(r=>setImmediate(r));
  assert.equal(w.subscriptionCount,1);const current=w.client;await w.shutdown();assert.deepEqual(current.unsubscribed,['1.20']);
});
test('unsubscribe clears the event connection even if the library fails to remove subscriptions',async()=>{
  const w=new HttpWrapper(log,'id','127.0.0.1',123,{},50,Client);
  await w.subscribeCharacteristics(['1.10']);const old=w.client;
  await w.unsubscribeAll();assert.deepEqual(old.unsubscribed,['1.10']);assert.equal(old.closed,true);assert.equal(w.subscriptionCount,0);
  await w.subscribeCharacteristics(['1.20']);assert.equal(w.subscriptionCount,1);await w.shutdown();
});
test('changed endpoint creates a new transport and preserves event watchers',async()=>{
  const w=new HttpWrapper(log,'id','127.0.0.1',123,{},50,Client);const old=w.client;
  let events=0;w.watch({cname:'1.10'},()=>events++);w.updateEndpoint('192.0.2.1',456);
  assert.equal(old.closed,true);assert.notEqual(w.client,old);
  w.client.emit('event',{characteristics:[{aid:1,iid:10,value:true}]});assert.equal(events,1);await w.shutdown();
});
