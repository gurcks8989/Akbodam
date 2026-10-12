import {test} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {installNotes} from '../notes-store.mjs';
import {backupData} from '../updates.mjs';
test('notes persist independently, validate strokes, reject stale writes and enter backups',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'akbodam-notes-'));let server;
 try{
 const app=express();app.use(express.json());installNotes(app,{dataDir:dir,hasScore:id=>id==='score'});server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
 const get=async id=>(await fetch(base+`/api/scores/${id}/notes`));const put=async body=>fetch(base+'/api/scores/score/notes',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await get('missing')).status,404);assert.deepEqual(await(await get('score')).json(),{revision:0,pages:{}});
 const stroke={id:'line-1',tool:'pen',color:'#cc2222',width:.003,points:[[.1,.2],[.3,.4]]};
 assert.equal((await put({revision:0,pages:{1:[{...stroke,points:[[1.2,.1]]}]}})).status,400);
 assert.equal((await put({revision:0,pages:{1:[{...stroke,color:'url(x)'}]}})).status,400);
 assert.equal((await put({revision:0,pages:{1:[stroke,stroke]}})).status,400);
 assert.equal((await put({revision:0,pages:{1:[stroke],2:[{...stroke,tool:'highlight'}]}})).status,200);
 assert.equal((await put({revision:0,pages:{}})).status,409);
 assert.equal((await(await get('score')).json()).pages[2][0].tool,'highlight');
 const backup=backupData(dir,{scores:[{id:'score'}],playlists:[]});assert.equal(JSON.parse(fs.readFileSync(path.join(backup.path,'notes/score.json'))).revision,1);
 assert.equal((await put({revision:1,pages:{}})).status,200);assert.deepEqual((await(await get('score')).json()).pages,{});
 }finally{if(server)await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});
