import express from 'express';
import multer from 'multer';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import QRCode from 'qrcode';

const publicDir=path.join(path.dirname(fileURLToPath(import.meta.url)),'phone');
export function networkAddresses() {
  return Object.entries(os.networkInterfaces()).flatMap(([name,entries])=>(entries||[]).filter(e=>e.family==='IPv4'&&!e.internal).map(e=>({name,address:e.address})));
}
// Separate listener: the library, files, settings and updater are never mounted here.
export function createPhoneTransfer({importFiles,canReceive=()=>true,addresses=networkAddresses,ttl=10*60*1000}) {
  let session=null, starting=false, generation=0;
  function stop() {
    generation++; const old=session; session=null;
    if(old){clearTimeout(old.timer);old.server.close();old.server.closeAllConnections();}
  }
  function status() {
    if(session && Date.now()>=session.expiresAt) stop();
    return session?{active:true,id:session.id,url:session.url,qr:session.qr,expiresAt:session.expiresAt,received:session.received}:{active:false};
  }
  async function start(address) {
    if(starting) throw new Error('전송 준비 중입니다. 잠시 후 다시 시도해 주세요.');
    if(!addresses().some(a=>a.address===address)) throw new Error('이 기기의 Wi-Fi 주소를 선택해 주세요.');
    starting=true;
    try {
      stop(); const myGeneration=generation;
      const token=randomBytes(24).toString('hex');
      const current={id:randomBytes(12).toString('hex'),expiresAt:Date.now()+ttl,received:[],busy:false};
      const app=express();app.disable('x-powered-by');
      app.use((req,res,next)=>{
        res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"});
        if(session!==current || Date.now()>=current.expiresAt) return res.status(410).json({error:'전송 시간이 끝났습니다. 악보담에서 QR을 다시 열어주세요.'});
        if(req.headers.host!==`${address}:${current.port}`) return res.status(403).json({error:'QR의 주소로 접속해 주세요.'});
        if(req.headers.origin && req.headers.origin!==`http://${address}:${current.port}`) return res.status(403).json({error:'다른 페이지에서의 요청은 허용하지 않습니다.'});
        next();
      });
      app.get('/',(_req,res)=>res.sendFile('index.html',{root:publicDir}));
      for(const file of ['upload.js','style.css']) app.get('/'+file,(_req,res)=>res.sendFile(file,{root:publicDir}));
      function authorize(req,res,next) {
        const supplied=Buffer.from(req.headers.authorization||''), expected=Buffer.from('Bearer '+token);
        if(supplied.length!==expected.length || !timingSafeEqual(supplied,expected)) return res.status(403).json({error:'접속 코드가 올바르지 않습니다. QR을 다시 스캔해 주세요.'});
        if(!canReceive()) return res.status(409).json({error:'악보담 업데이트 중입니다. 완료 후 다시 전송해 주세요.'});
        next();
      }
      app.get('/session',authorize,(_req,res)=>res.json({expiresAt:current.expiresAt}));
      const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:50*1024*1024,files:1,fields:0,parts:1}}).single('file');
      app.post('/upload',authorize,(req,res)=>{
        if(current.busy) return res.status(409).json({error:'다른 파일을 받고 있습니다. 잠시 후 다시 시도해 주세요.'});
        current.busy=true;
        const release=()=>{current.busy=false;};res.once('close',release);
        upload(req,res,error=>{
          try {
            if(session!==current || Date.now()>=current.expiresAt) return res.status(410).json({error:'전송 시간이 끝났습니다.'});
            if(!canReceive()) return res.status(409).json({error:'업데이트 중에는 파일을 받을 수 없습니다.'});
            if(error) return res.status(400).json({error:error.code==='LIMIT_FILE_SIZE'?'파일은 50MB 이하여야 합니다.':'한 번에 파일 하나를 전송해 주세요.'});
            const file=req.file;
            if(!file) return res.status(400).json({error:'사진이나 PDF를 선택해 주세요.'});
            file.originalname=Buffer.from(file.originalname,'latin1').toString('utf8');
            if(!/\.(pdf|png|jpe?g)$/i.test(file.originalname)) return res.status(400).json({error:'PDF, JPG, PNG만 전송할 수 있습니다. HEIC 사진은 JPG로 변환해 주세요.'});
            const {score,duplicate}=importFiles(file);
            current.received.push({id:randomBytes(8).toString('hex'),scoreId:score.id,title:score.title,duplicate});
            if(current.received.length>100) current.received.shift();
            res.status(201).json({title:score.title,duplicate});
          } catch(e){res.status(400).json({error:e.message});}
          finally {release();}
        });
      });
      app.use((_req,res)=>res.status(404).json({error:'업로드 전용 화면입니다.'}));
      const server=app.listen(0,address);current.server=server;
      await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
      current.port=server.address().port;current.url=`http://${address}:${current.port}/#${token}`;
      try {current.qr=await QRCode.toDataURL(current.url,{width:300,margin:4,errorCorrectionLevel:'M'});}
      catch(e){server.close();throw e;}
      if(generation!==myGeneration){server.close();throw new Error('전송 준비가 취소되었습니다.');}
      session=current;current.timer=setTimeout(stop,ttl);current.timer.unref();server.unref();
      return status();
    } finally {starting=false;}
  }
  return {start,stop,status,addresses};
}
