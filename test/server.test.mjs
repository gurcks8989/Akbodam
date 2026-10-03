import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server.mjs';
import { pdfFixture } from './fixtures.mjs';
test('local library: import, durable independent copy, duplicate entries, validation and restart', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(),'score-test-'));
  const dir = path.join(parent,'.hidden-project','data'); let server;
  const start = async () => { server = createApp(dir).listen(0,'127.0.0.1'); await new Promise(r => server.once('listening',r)); return `http://127.0.0.1:${server.address().port}`; };
  const stop = () => new Promise(r => server.close(r));
  try {
    let base = await start(); const call = (url, method, body) => fetch(base + url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const form = new FormData(); form.append('files',new Blob([pdfFixture()]),'테스트 악보.pdf');
    let res = await fetch(base+'/api/scores',{method:'POST',body:form}); assert.equal(res.status,201);
    const [score] = await res.json(); assert.equal(score.title,'테스트 악보');
    assert.deepEqual(Buffer.from(await (await fetch(base+`/api/scores/${score.id}/file`)).arrayBuffer()),pdfFixture());
    const state = await (await fetch(base+'/api/state')).json(); const list = state.playlists[0];
    list.items = [{id:'first',scoreId:score.id},{id:'second',scoreId:score.id}];
    assert.equal((await call(`/api/playlists/${list.id}`,'PUT',list)).status,200);
    assert.equal((await call(`/api/progress/${list.id}`,'PUT',{itemId:'second',page:2,zoom:1.2})).status,200);
    assert.equal((await call(`/api/playlists/${list.id}`,'PUT',{...list,items:[{id:'bad',scoreId:'absent'}]})).status,400);
    const bad = new FormData(); bad.append('files',new Blob([pdfFixture()]),'valid.pdf'); bad.append('files',new Blob(['not a pdf']),'bad.pdf');
    assert.equal((await fetch(base+'/api/scores',{method:'POST',body:bad})).status,400); assert.equal(fs.readdirSync(path.join(dir,'scores')).length,1);
    assert.equal((await fetch(base+'/api/playlists',{method:'POST',headers:{Origin:'https://example.com','Content-Type':'application/json'},body:'{"name":"bad"}'})).status,403);
    const source = path.join(dir,'source'); fs.mkdirSync(source); fs.writeFileSync(path.join(source,'테스트.pdf'),pdfFixture());
    assert.equal((await call('/api/settings','PUT',{sourceFolder:source})).status,200);
    assert.equal((await (await fetch(base+'/api/source-files')).json()).files[0].name,'테스트.pdf');
    assert.equal((await call('/api/source-import','POST',{names:['../test.pdf']})).status,400);
    assert.equal((await call('/api/source-import','POST',{names:['테스트.pdf']})).status,201);
    assert.equal((await (await fetch(base+'/api/state')).json()).scores.length,1);
    fs.unlinkSync(path.join(source,'테스트.pdf'));
    assert.equal((await fetch(base+`/api/scores/${score.id}/file`)).status,200);
    await stop(); base = await start(); const restored = await (await fetch(base+'/api/state')).json();
    assert.equal(restored.scores.length,1); assert.equal(restored.playlists[0].items.length,2); assert.equal(restored.progress[list.id].page,2);
    assert.equal(restored.settings.sourceFolder,fs.realpathSync(source));
  } finally { await stop(); fs.rmSync(parent,{recursive:true,force:true}); }
});
