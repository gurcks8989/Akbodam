import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import os from 'node:os';
import { repositoryUrl, checkRelease, backupData, prepareRelease } from './updates.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
export function createApp(dataDir = process.env.SCORE_DATA_DIR || path.join(root, 'data')) {
  dataDir = path.resolve(dataDir);
  fs.mkdirSync(path.join(dataDir, 'scores'), { recursive: true });
  const statePath = path.join(dataDir, 'library.json');
  let state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : {
    version: 1, scores: [], playlists: [{ id: randomUUID(), name: '나의 첫 콘티', items: [] }], progress: {}
  };
  function save(next) {
    const tmp = statePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
    fs.renameSync(tmp, statePath);
    state = next;
  }
  function importFiles(files) {
    const created = [];
    const imported = new Map(state.scores.filter(s => s.hash).map(s => [s.hash, s]));
    try {
      const scores = files.map(file => {
        const name = file.originalname;
        const ext = path.extname(name).toLowerCase();
        const types = { '.pdf': 'pdf', '.jpg': 'image', '.jpeg': 'image', '.png': 'image', '.xml': 'musicxml', '.musicxml': 'musicxml' };
        const kind = types[ext];
        const header = file.buffer.subarray(0, 1024).toString('utf8');
        if (!kind || (kind === 'pdf' && !header.includes('%PDF-')) || (kind === 'musicxml' && (!/<score-(partwise|timewise)[\s>]/.test(file.buffer.toString('utf8')) || /<!ENTITY/i.test(file.buffer.toString('utf8')))) || (ext === '.png' && file.buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') || (['.jpg', '.jpeg'].includes(ext) && file.buffer.subarray(0, 2).toString('hex') !== 'ffd8')) {
          throw new Error(`${name}: PDF, PNG, JPG 또는 MusicXML 파일인지 확인해 주세요. 압축 MXL은 먼저 XML로 풀어 주세요.`);
        }
        const hash = createHash('sha256').update(file.buffer).digest('hex');
        const existing = imported.get(hash);
        if (existing) return existing;
        const id = randomUUID();
        const storedName = id + ext;
        const dest = path.join(dataDir, 'scores', storedName);
        fs.writeFileSync(dest, file.buffer);
        created.push(dest);
        const score = { id, hash, title: path.basename(name, path.extname(name)), originalName: name, kind, storedName, bytes: file.size, addedAt: new Date().toISOString() };
        imported.set(hash, score);
        return score;
      });
      const unique = [...new Map(scores.map(s => [s.id, s])).values()];
      save({ ...state, scores: [...state.scores, ...unique.filter(s => !state.scores.some(old => old.id === s.id))] });
      return unique;
    } catch(error) {
      created.forEach(file => fs.rmSync(file, { force: true }));
      throw error;
    }
  }
  const currentVersion=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
  let updateJob={phase:'idle',message:''}, checkedRelease=null;
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(req.hostname)) return res.status(403).json({ error: '로컬 주소로 접속해 주세요.' });
    if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin && req.headers.origin !== `${req.protocol}://${req.headers.host}`) return res.status(403).json({ error: '외부 페이지의 요청은 허용하지 않습니다.' });
    if(updateJob.phase==='preparing' && !['GET','HEAD'].includes(req.method)) return res.status(409).json({error:'업데이트 준비 중입니다. 완료 후 다시 시도해 주세요.'});
    res.set('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  app.get('/api/state', (_req, res) => res.json(state));
  app.get('/api/updates', (_req,res) => {
    const marker=path.join(dataDir,'active-release.json');
    const active=fs.existsSync(marker)?JSON.parse(fs.readFileSync(marker,'utf8')):null;
    res.json({currentVersion,repository:state.settings?.updateRepository || '',managed:process.env.AKBODAM_MANAGED==='1',release:checkedRelease,job:updateJob,canRollback:Boolean(active?.previous),lastBackup:state.settings?.lastBackup || null});
  });
  app.put('/api/updates/repository',(req,res)=>{
    try { const repository=repositoryUrl(req.body.repository); save({...state,settings:{...state.settings,updateRepository:repository}}); checkedRelease=null; res.json({repository}); }
    catch(e){res.status(400).json({error:e.message});}
  });
  app.post('/api/updates/check',async(_req,res)=>{
    try { if(!state.settings?.updateRepository) throw new Error('GitHub 저장소를 먼저 등록해 주세요.'); checkedRelease=await checkRelease(state.settings.updateRepository,currentVersion); res.json(checkedRelease); }
    catch(e){res.status(400).json({error:e.message});}
  });
  app.post('/api/updates/backup',(_req,res)=>{
    try { const backup=backupData(dataDir,state); save({...state,settings:{...state.settings,lastBackup:backup}}); res.json(backup); }
    catch{res.status(500).json({error:'백업에 실패했습니다. 디스크 여유 공간을 확인해 주세요.'});}
  });
  app.post('/api/updates/install',(_req,res)=>{
    if(process.env.AKBODAM_MANAGED!=='1') return res.status(409).json({error:'업데이트를 적용하려면 npm start로 프로그램을 실행해 주세요.'});
    if(!checkedRelease?.available) return res.status(409).json({error:'설치할 새 버전을 먼저 확인해 주세요.'});
    const release=structuredClone(checkedRelease);
    updateJob={phase:'preparing',message:`${release.latest} 준비 중… 연주와 편집은 완료 후 재개하세요.`};
    res.status(202).json(updateJob);
    (async()=>{
      try {
        const destination=await prepareRelease(root,dataDir,release);
        const backup=backupData(dataDir,state);
        save({...state,settings:{...state.settings,lastBackup:backup}});
        const marker=path.join(dataDir,'active-release.json');
        fs.writeFileSync(marker+'.tmp',JSON.stringify({current:destination,previous:root,backup:backup.path,version:release.latest})); fs.renameSync(marker+'.tmp',marker);
        updateJob={phase:'restarting',message:'새 버전으로 재시작합니다.'};
        setTimeout(()=>process.exit(75),1200);
      } catch(e) { updateJob={phase:'failed',message:e.message}; }
    })();
  });
  app.post('/api/updates/rollback',(_req,res)=>{
    const marker=path.join(dataDir,'active-release.json');
    const active=fs.existsSync(marker)?JSON.parse(fs.readFileSync(marker,'utf8')):null;
    if(process.env.AKBODAM_MANAGED!=='1' || !active?.previous) return res.status(409).json({error:'돌아갈 이전 프로그램 버전이 없습니다.'});
    fs.writeFileSync(marker+'.tmp',JSON.stringify({...active,current:active.previous,previous:null}));fs.renameSync(marker+'.tmp',marker);
    res.json({message:'이전 프로그램으로 돌아갑니다. 악보와 콘티 데이터는 현재 상태를 유지합니다.'});setTimeout(()=>process.exit(75),1000);
  });
  const supported = /\.(pdf|png|jpe?g|xml|musicxml)$/i;
  function sourceFolder() {
    const folder = state.settings?.sourceFolder;
    if (!folder) throw new Error('설정에서 악보 폴더를 먼저 지정해 주세요.');
    return folder;
  }
  app.get('/api/settings', (_req, res) => res.json({ sourceFolder: state.settings?.sourceFolder || '', storageFolder: dataDir }));
  app.put('/api/settings', (req, res) => {
    try {
      const input = String(req.body.sourceFolder || '').trim();
      const expanded = input.startsWith('~/') ? path.join(os.homedir(), input.slice(2)) : input;
      if (!path.isAbsolute(expanded)) throw new Error('폴더의 전체 경로를 입력해 주세요.');
      const folder = fs.realpathSync(expanded);
      if (!fs.statSync(folder).isDirectory()) throw new Error('파일 대신 폴더를 지정해 주세요.');
      fs.accessSync(folder, fs.constants.R_OK);
      save({ ...state, settings: { ...state.settings, sourceFolder: folder } });
      res.json({ sourceFolder: folder, storageFolder: dataDir });
    } catch (e) { res.status(400).json({ error: e.code ? '폴더를 찾거나 읽을 수 없습니다. 경로와 접근 권한을 확인해 주세요.' : e.message }); }
  });
  app.get('/api/source-files', (_req, res) => {
    try {
      const folder = sourceFolder();
      const entries = fs.readdirSync(folder, { withFileTypes: true });
      const folders = entries.filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => ({ name:e.name, path:path.join(folder,e.name) })).sort((a,b) => a.name.localeCompare(b.name));
      const files = entries.filter(e => e.isFile() && supported.test(e.name)).map(e => {
        const stat = fs.statSync(path.join(folder, e.name)); return { name: e.name, bytes: stat.size, tooLarge: stat.size > 50 * 1024 * 1024 };
      }).sort((a,b) => a.name.localeCompare(b.name, 'ko'));
      res.json({ folder, folders, files });
    } catch (e) { res.status(400).json({ error: e.code ? '지정한 폴더를 읽을 수 없습니다. 설정에서 경로를 확인해 주세요.' : e.message }); }
  });
  app.post('/api/source-import', (req, res) => {
    try {
      const names = req.body.names;
      if (!Array.isArray(names) || names.length < 1 || names.length > 10) throw new Error('한 번에 1~10개의 파일을 선택해 주세요.');
      const folder = sourceFolder();
      const files = names.map(name => {
        if (typeof name !== 'string' || path.basename(name) !== name || name.includes('\\') || !supported.test(name)) throw new Error('선택한 파일 이름이 올바르지 않습니다.');
        const file = path.join(folder, name); const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 50 * 1024 * 1024) throw new Error(`${name}: 일반 파일이며 50MB 이하여야 합니다.`);
        return { originalname: name, buffer: fs.readFileSync(file), size: stat.size };
      });
      res.status(201).json(importFiles(files));
    } catch(e) { res.status(400).json({ error: e.code ? '파일을 읽지 못했습니다. 폴더와 파일을 확인해 주세요.' : e.message }); }
  });
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024, files: 10 } });
  app.post('/api/scores', upload.array('files', 10), (req, res) => {
    if (!req.files?.length) return res.status(400).json({ error: '파일을 선택해 주세요.' });
    try { res.status(201).json(importFiles(req.files.map(file => ({...file, originalname: Buffer.from(file.originalname, 'latin1').toString('utf8')})))); } catch(error) { res.status(400).json({error:error.message}); }
  });
  app.get('/api/scores/:id/file', (req, res) => {
    const score = state.scores.find(s => s.id === req.params.id);
    if (!score) return res.status(404).json({ error: '악보가 없습니다.' });
    res.sendFile(score.storedName, { root: path.join(dataDir, 'scores') }, error => {
      if (error && !res.headersSent) res.status(error.statusCode || 500).json({ error: '보관된 악보 파일을 읽지 못했습니다. 파일 위치를 확인해 주세요.' });
    });
  });
  app.post('/api/playlists', (req, res) => {
    const name = String(req.body.name || '').trim().slice(0, 100);
    if (!name) return res.status(400).json({ error: '콘티 이름을 입력해 주세요.' });
    const list = { id: randomUUID(), name, items: [] };
    save({ ...state, playlists: [...state.playlists, list] });
    res.status(201).json(list);
  });
  app.put('/api/playlists/:id', (req, res) => {
    const old = state.playlists.find(p => p.id === req.params.id);
    if (!old) return res.status(404).json({ error: '콘티가 없습니다.' });
    const { name, items } = req.body;
    if (typeof name !== 'string' || !name.trim() || name.length > 100 || !Array.isArray(items) || items.length > 500 || new Set(items.map(i => i.id)).size !== items.length || items.some(i => typeof i.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(i.id) || !state.scores.some(s => s.id === i.scoreId))) return res.status(400).json({ error: '콘티 항목을 확인해 주세요.' });
    const list = { id: old.id, name: name.trim(), items: items.map(i => ({ id: i.id, scoreId: i.scoreId })) };
    save({ ...state, playlists: state.playlists.map(p => p.id === list.id ? list : p) });
    res.json(list);
  });
  app.put('/api/progress/:id', (req, res) => {
    const list = state.playlists.find(p => p.id === req.params.id);
    const { itemId, page, zoom } = req.body;
    if (!list?.items.some(i => i.id === itemId) || !Number.isInteger(page) || page < 1 || page > 10000 || !Number.isFinite(zoom) || zoom < 0.5 || zoom > 2) return res.status(400).json({ error: '읽기 위치가 올바르지 않습니다.' });
    save({ ...state, progress: { ...state.progress, [list.id]: { itemId, page, zoom } } });
    res.json({ ok: true });
  });
  app.use('/vendor/pdf', express.static(path.join(root, 'node_modules/pdfjs-dist')));
  app.use('/vendor/verovio', express.static(path.join(root, 'node_modules/verovio/dist')));
  app.use(express.static(path.join(root, 'public')));
  app.use((error, _req, res, _next) => res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? '파일은 각각 50MB 이하로 추가해 주세요.' : error.code === 'LIMIT_FILE_COUNT' ? '한 번에 10개 이하로 추가해 주세요.' : '요청을 처리하지 못했습니다. 파일과 입력 내용을 확인해 주세요.' }));
  return app;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4173);
  createApp().listen(port, '127.0.0.1', () => console.log(`악보대: http://127.0.0.1:${port}`));
}
