import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPhoneTransfer } from '../phone-transfer.mjs';
import { pdfFixture } from './fixtures.mjs';
test('phone listener: authenticated upload only, duplicates, revocation and expiry',async()=>{
  let count=0,allowed=true;
  const transfer=createPhoneTransfer({addresses:()=>[{name:'test',address:'127.0.0.1'}],ttl:30000,canReceive:()=>allowed,importFiles:file=>{assert.ok(file.buffer.equals(pdfFixture()));assert.equal(file.originalname,'찬양.pdf');return {score:{id:'score',title:'찬양'},duplicate:count++>0};}});
  const upload=()=>{const form=new FormData();form.append('file',new Blob([pdfFixture()]),'찬양.pdf');return form;};
  try {
    await assert.rejects(()=>transfer.start('8.8.8.8'));
    const session=await transfer.start('127.0.0.1'),url=new URL(session.url),base=url.origin,headers={Authorization:'Bearer '+url.hash.slice(1)};
    assert.match(session.qr,/^data:image\/png;base64,/);
    assert.equal((await fetch(base+'/api/state')).status,404);
    assert.equal((await fetch(base+'/api/updates')).status,404);
    assert.equal((await fetch(base+'/upload',{method:'POST',body:upload()})).status,403);
    assert.equal((await fetch(base+'/upload',{method:'POST',headers:{...headers,Origin:'https://example.com'},body:upload()})).status,403);
    let res=await fetch(base+'/upload',{method:'POST',headers,body:upload()});assert.equal(res.status,201,await res.clone().text());assert.equal((await res.json()).duplicate,false);
    res=await fetch(base+'/upload',{method:'POST',headers,body:upload()});assert.equal((await res.json()).duplicate,true);
    assert.equal(transfer.status().received.length,2);assert.equal(count,2);
    allowed=false;assert.equal((await fetch(base+'/upload',{method:'POST',headers,body:upload()})).status,409);allowed=true;
    const next=await transfer.start('127.0.0.1');assert.equal((await fetch(new URL(next.url).origin+'/session',{headers})).status,403);
    transfer.stop();assert.equal(transfer.status().active,false);await assert.rejects(()=>fetch(new URL(next.url).origin+'/'));
  }finally{transfer.stop();}
  const expiry=createPhoneTransfer({addresses:()=>[{address:'127.0.0.1'}],ttl:50,importFiles:()=>{throw Error('expired');}});
  await expiry.start('127.0.0.1');await new Promise(r=>setTimeout(r,80));assert.equal(expiry.status().active,false);expiry.stop();
});
