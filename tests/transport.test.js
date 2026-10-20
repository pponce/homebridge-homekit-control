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
