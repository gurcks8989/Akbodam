import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import multer from 'multer';
import {PDFDocument,rgb,LineCapStyle} from 'pdf-lib';
import {createPhoneTransfer} from './phone-transfer.mjs';

function paintNotes(page,strokes){
  const box=page.getCropBox(),rotation=((page.getRotation().angle%360)+360)%360;
  const displayWidth=rotation===90||rotation===270?box.height:box.width;
  const transform=([u,v])=>{
    if(rotation===90)return [box.x+v*box.width,box.y+u*box.height];
    if(rotation===180)return [box.x+(1-u)*box.width,box.y+v*box.height];
    if(rotation===270)return [box.x+(1-v)*box.width,box.y+(1-u)*box.height];
    return [box.x+u*box.width,box.y+(1-v)*box.height];
  };
  for(const stroke of strokes){
    const points=stroke.points.map(transform),color=rgb(...[1,3,5].map(i=>parseInt(stroke.color.slice(i,i+2),16)/255));
    const svg=points.map(([x,y],i)=>`${i?'L':'M'}${x} ${-y}`).join(' ')+(points.length===1?' l.01 0':'');
    page.drawSvgPath(svg,{x:0,y:0,borderColor:color,borderWidth:stroke.width*displayWidth,borderOpacity:stroke.tool==='highlight'?.32:1,borderLineCap:LineCapStyle.Round});
  }
}
export async function buildExport({scores,dataDir,includeNotes,xmlPages=new Map()}){
  const output=await PDFDocument.create();output.setProducer('Akbodam');
  const documents=new Map();let total=0;
  for(const score of scores){
    let pages=[];
    if(score.kind==='pdf'){
      if(!documents.has(score.id))documents.set(score.id,await PDFDocument.load(fs.readFileSync(path.join(dataDir,'scores',score.storedName))));
      const source=documents.get(score.id);if(total+source.getPageCount()>200)throw Error('한 번에 200페이지 이하로 내보내 주세요.');
      pages=await output.copyPages(source,source.getPageIndices());pages.forEach(p=>output.addPage(p));
    }else{
      const images=score.kind==='musicxml'?xmlPages.get(score.id):(xmlPages.get(score.id)||[fs.readFileSync(path.join(dataDir,'scores',score.storedName))]);
      if(!images?.length)throw Error(`${score.title}: MusicXML 페이지를 준비하지 못했습니다.`);
      if(total+images.length>200)throw Error('한 번에 200페이지 이하로 내보내 주세요.');
      for(const bytes of images){
        const image=bytes.subarray(0,8).toString('hex')==='89504e470d0a1a0a'?await output.embedPng(bytes):await output.embedJpg(bytes);
        const width=595.28,height=width*image.height/image.width,p=output.addPage([width,height]);p.drawImage(image,{x:0,y:0,width,height});pages.push(p);
      }
    }
    if(includeNotes){const file=path.join(dataDir,'notes',score.id+'.json'),notes=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')).pages:{};pages.forEach((p,i)=>paintNotes(p,notes[i+1]||[]));}
    total+=pages.length;
  }
  if(!total)throw Error('내보낼 악보를 선택해 주세요.');
  return {bytes:await output.save(),pages:total};
}
export function installExports(app,{dataDir,getState,canExport}){
  const dir=path.join(dataDir,'exports');fs.mkdirSync(dir,{recursive:true});
  for(const name of fs.readdirSync(dir))if(/^[a-f0-9-]+\.pdf$/.test(name))fs.rmSync(path.join(dir,name),{force:true});
  let current=null,busy=false;
  const phone=createPhoneTransfer({canReceive:canExport});
  const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024,files:50,fields:1,fieldSize:100000}}).array('pages',50);
  app.post('/api/export',(req,res)=>{
    if(busy)return res.status(409).json({error:'다른 PDF를 준비 중입니다. 잠시 후 다시 시도해 주세요.'});
    busy=true;
    upload(req,res,async error=>{
      try{
        if(error)throw Error('MusicXML 이미지는 페이지당 5MB, 최대 50페이지까지 내보낼 수 있습니다.');
        if(!canExport())throw Error('업데이트 중에는 내보낼 수 없습니다.');
        const options=JSON.parse(req.body.options||'{}'),state=getState();
        if(typeof options.includeNotes!=='boolean')throw Error('메모 포함 여부를 선택해 주세요.');
        const playlist=options.scope==='playlist'?state.playlists.find(p=>p.id===options.playlistId):null;
        const scores=options.scope==='score'?[state.scores.find(s=>s.id===options.scoreId)]:playlist?.items.map(i=>state.scores.find(s=>s.id===i.scoreId));
        if(!scores?.length||scores.some(s=>!s)||scores.length>200)throw Error('내보낼 악보나 콘티를 확인해 주세요.');
        const xmlPages=new Map();
        for(const entry of options.xml||[]){
          if(!scores.some(s=>s.id===entry.scoreId&&['musicxml','image'].includes(s.kind))||!Number.isInteger(entry.count)||entry.count<1||entry.count>50)throw Error('MusicXML 페이지 목록이 올바르지 않습니다.');
          const files=Array.from({length:entry.count},(_,i)=>req.files?.find(f=>f.originalname===`${entry.scoreId}-${i+1}.png`));
          if(files.some(f=>!f||f.buffer.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'))throw Error('MusicXML 페이지 이미지를 확인해 주세요.');
          xmlPages.set(entry.scoreId,files.map(f=>f.buffer));
        }
        const result=await buildExport({scores,dataDir,includeNotes:options.includeNotes,xmlPages});
        if(!canExport())throw Error('업데이트 중입니다. 완료 후 다시 내보내 주세요.');
        const id=randomUUID(),filename=(playlist?.name||scores[0].title).replace(/[\\/\x00-\x1f]/g,'_').slice(0,100)+(options.includeNotes?'_메모포함':'')+'.pdf',file=path.join(dir,id+'.pdf');
        fs.writeFileSync(file,result.bytes);phone.stop();if(current)fs.rmSync(current.file,{force:true});current={id,file,filename,pages:result.pages,bytes:result.bytes.length};
        res.status(201).json({...current,file:undefined});
      }catch(e){res.status(400).json({error:e.message});}finally{busy=false;}
    });
  });
  app.get('/api/export/:id/file',(req,res)=>{if(current?.id!==req.params.id)return res.status(404).json({error:'PDF를 다시 준비해 주세요.'});res.download(path.basename(current.file),current.filename,{root:dir});});
  app.get('/api/export/phone',(_req,res)=>res.json({...phone.status(),addresses:phone.addresses()}));
  app.post('/api/export/:id/phone',async(req,res)=>{try{if(current?.id!==req.params.id)throw Error('PDF를 먼저 준비해 주세요.');res.json(await phone.start(req.body.address,{file:current.file,filename:current.filename,bytes:current.bytes}));}catch(e){res.status(400).json({error:e.code?'Wi-Fi 주소와 방화벽을 확인해 주세요.':e.message});}});
  app.delete('/api/export/phone',(_req,res)=>{phone.stop();res.json({active:false});});
}
