const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Sequencer, checkStatus } = require('../dist/HttpWrapper');
const delay = ms => new Promise(r=>setTimeout(r,ms));
test('late completion cannot clear the next request timeout', async () => {
  const q = new Sequencer(25);
  let finish;
  const one = q.push(()=>new Promise(r=>{finish=r;}));
  const two = q.push(()=>new Promise(()=>{}));
  const oneCheck = assert.rejects(one,/timed out/);
  const twoCheck = assert.rejects(two,/timed out/);
  await oneCheck; finish('late');
  await twoCheck;
  assert.equal(await q.push(async()=>42),42); q.close();
});
test('abort rejects queued work; writes are not replayed', async () => {
  let count=0;
  const q=new Sequencer(20,()=>q.abort());
  const first=q.push(()=>{count++;return new Promise(()=>{});});
  const next=q.push(async()=>{count++;});
  await Promise.all([assert.rejects(first),assert.rejects(next)]);
  await delay(30);assert.equal(count,1);q.close();
});
test('shutdown rejects active and pending work and prevents new work', async()=>{
  const q=new Sequencer(100); const a=q.push(()=>new Promise(()=>{}));const b=q.push(async()=>1);
  q.close();await Promise.all([assert.rejects(a),assert.rejects(b),assert.rejects(q.push(async()=>2))]);
});
test('HTTP 207 per-characteristic errors reject a write',()=>{
  assert.throws(()=>checkStatus({characteristics:[{aid:1,iid:9,status:-70402}]}),/status -70402/);
  assert.doesNotThrow(()=>checkStatus({characteristics:[{status:0}]}));
});
