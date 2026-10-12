import fs from 'node:fs';
import path from 'node:path';

export function installNotes(app,{dataDir,hasScore}) {
  const dir=path.join(dataDir,'notes');
  const read=id=>{const file=path.join(dir,id+'.json');return fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{revision:0,pages:{}};};
  function check(req,res,next){if(!hasScore(req.params.id))return res.status(404).json({error:'악보를 찾을 수 없습니다.'});next();}
  app.get('/api/scores/:id/notes',check,(req,res)=>res.json(read(req.params.id)));
  app.put('/api/scores/:id/notes',check,(req,res)=>{
    const {revision,pages}=req.body;
    if(!Number.isInteger(revision)||revision<0||!pages||typeof pages!=='object'||Array.isArray(pages)||Object.keys(pages).length>1000)return res.status(400).json({error:'메모 데이터가 올바르지 않습니다.'});
    let count=0,points=0;
    for(const [page,strokes] of Object.entries(pages)){
      if(!/^[1-9][0-9]{0,3}$/.test(page)||!Array.isArray(strokes))return res.status(400).json({error:'메모 페이지가 올바르지 않습니다.'});
      for(const stroke of strokes){
        if(++count>2000||!stroke||typeof stroke.id!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(stroke.id)||!['pen','highlight'].includes(stroke.tool)||!/^#[0-9a-fA-F]{6}$/.test(stroke.color)||!Number.isFinite(stroke.width)||stroke.width<.001||stroke.width>.05||!Array.isArray(stroke.points)||!stroke.points.length||stroke.points.length>5000)return res.status(400).json({error:'메모 크기나 펜 설정을 확인해 주세요.'});
        for(const point of stroke.points){if(++points>30000||!Array.isArray(point)||point.length!==2||point.some(n=>!Number.isFinite(n)||n<0||n>1))return res.status(400).json({error:'메모 좌표나 크기를 확인해 주세요.'});}
      }
      if(new Set(strokes.map(s=>s.id)).size!==strokes.length)return res.status(400).json({error:'메모 항목이 중복되었습니다.'});
    }
    const current=read(req.params.id);
    if(current.revision!==revision)return res.status(409).json({error:'다른 화면에서 메모가 변경되었습니다. 메모를 다시 불러온 뒤 편집해 주세요.'});
    const next={revision:revision+1,pages};fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,req.params.id+'.json');fs.writeFileSync(file+'.tmp',JSON.stringify(next));fs.renameSync(file+'.tmp',file);res.json({revision:next.revision});
  });
}
