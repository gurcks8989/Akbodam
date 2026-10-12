import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PDFDocument,degrees} from 'pdf-lib';
import {buildExport} from '../exports.mjs';
import {pdfFixture,pngFixture} from './fixtures.mjs';
test('export preserves original PDF pages, crop and rotation, appends images and page notes',async()=>{
 const data=fs.mkdtempSync(path.join(os.tmpdir(),'akbodam-export-'));
 try{
 fs.mkdirSync(path.join(data,'scores'));fs.mkdirSync(path.join(data,'notes'));
 const doc=await PDFDocument.load(pdfFixture());doc.getPage(0).setRotation(degrees(90));doc.getPage(0).setCropBox(20,30,500,700);fs.writeFileSync(path.join(data,'scores','score.pdf'),await doc.save());fs.writeFileSync(path.join(data,'scores','image.png'),pngFixture);
 const strokes=[{id:'red',tool:'pen',color:'#ff0000',width:.007,points:[[.2,.3],[.8,.3]]},{id:'yellow',tool:'highlight',color:'#ffcc00',width:.03,points:[[.2,.5],[.8,.5]]}];fs.writeFileSync(path.join(data,'notes','score.json'),JSON.stringify({revision:1,pages:{1:strokes,2:strokes}}));
 const scores=[{id:'score',storedName:'score.pdf',kind:'pdf'},{id:'image',storedName:'image.png',kind:'image'},{id:'score',storedName:'score.pdf',kind:'pdf'}];
 const annotated=await buildExport({scores,dataDir:data,includeNotes:true});const clean=await buildExport({scores,dataDir:data,includeNotes:false});
 assert.equal(annotated.pages,5);const result=await PDFDocument.load(annotated.bytes);assert.equal(result.getPage(0).getRotation().angle,90);assert.equal(result.getPage(0).getCropBox().x,20);assert.equal(result.getPage(3).getRotation().angle,90);assert.ok(annotated.bytes.length>clean.bytes.length);
 fs.mkdirSync('test-results',{recursive:true});fs.writeFileSync('test-results/export-notes.pdf',annotated.bytes);
 await assert.rejects(()=>buildExport({scores:[{id:'xml',kind:'musicxml',title:'XML'}],dataDir:data,includeNotes:false}));
 const xml=await buildExport({scores:[{id:'xml',kind:'musicxml'}],dataDir:data,includeNotes:false,xmlPages:new Map([['xml',[pngFixture,pngFixture]]])});assert.equal(xml.pages,2);
 }finally{fs.rmSync(data,{recursive:true,force:true});}
});
