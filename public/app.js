import { installQueueDrag } from '/queue-drag.js';
import * as pdfjs from '/vendor/pdf/build/pdf.mjs';
pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdf/build/pdf.worker.mjs';
const $ = id => document.getElementById(id);
const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
let state, listId, currentId, page = 1, pages = 0, zoom = 1, documentData, token = 0, rendererPromise, nameMode, busy = false, toastTimer;
let standaloneScore = null;
let favoritesOnly = false;
let rotated = false, beforeRotation = null;
let spread = localStorage.getItem('on-eum-spread') === '2';
let viewMode = localStorage.getItem('on-eum-view-mode') || 'pages';
if (!['pages','vertical','horizontal'].includes(viewMode)) viewMode = 'pages';
const isSpread = () => spread && viewMode === 'pages';
const list = () => state?.playlists.find(p => p.id === listId);
const scoreOf = item => state.scores.find(s => s.id === item?.scoreId);
const currentIndex = () => list()?.items.findIndex(i => i.id === currentId) ?? -1;
async function api(url, method = 'GET', body) {
  const response = await fetch(url, { method, ...(body instanceof FormData ? { body } : body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || '저장에 실패했습니다. 프로그램이 실행 중인지 확인해 주세요.'); }
  return response.json();
}
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 4000); }
let mutationQueue = Promise.resolve();
function guarded(fn) { mutationQueue = mutationQueue.then(async () => { try { await fn(); } catch(e) { toast(e.message); } }); return mutationQueue; }
const previewCache = new Map();
let previewQueue = Promise.resolve();
function refreshPreviews(container) {
  for(const target of container.querySelectorAll('[data-preview]')) {
    const id=target.dataset.preview, score=state.scores.find(s=>s.id===id);
    if(!score || score.kind==='musicxml') continue;
    const fill = src => { if(!target.isConnected) return; const img=new Image(); img.src=src; img.alt=''; target.replaceChildren(img); };
    if(previewCache.has(id)) { fill(previewCache.get(id)); continue; }
    previewQueue=previewQueue.then(async()=>{
      if(!target.isConnected) return;
      if(previewCache.has(id)) { fill(previewCache.get(id)); return; }
      let task;
      try {
        let src=`/api/scores/${id}/file`;
        if(score.kind==='pdf') {
          task=pdfjs.getDocument({url:src,cMapUrl:'/vendor/pdf/cmaps/',cMapPacked:true,standardFontDataUrl:'/vendor/pdf/standard_fonts/',wasmUrl:'/vendor/pdf/wasm/',isEvalSupported:false});
          const doc=await task.promise, first=await doc.getPage(1), base=first.getViewport({scale:1});
          const viewport=first.getViewport({scale:200/base.width}), canvas=document.createElement('canvas');
          canvas.width=viewport.width; canvas.height=viewport.height;
          await first.render({canvasContext:canvas.getContext('2d'),viewport}).promise; src=canvas.toDataURL();
        }
        previewCache.set(id,src); fill(src);
      } catch { /* Keep the document placeholder when a preview cannot load. */ }
      finally { if(task) await task.destroy().catch(()=>{}); }
    });
  }
}
function drawLists() {
  $('playlist').innerHTML = state.playlists.map(p => `<option value="${p.id}">${escape(p.name)}</option>`).join(''); $('playlist').value = listId;
  const items = list().items;
  $('item-count').textContent = `${items.length}곡`;
  $('queue').innerHTML = items.map((item, index) => `<li class="queue-item ${item.id === currentId ? 'active' : ''}" data-item="${item.id}"><button class="song-select" data-select="${item.id}" ${item.id === currentId ? 'aria-current="true"' : ''}><span class="score-preview" data-preview="${item.scoreId}"><span class="song-number">${String(index + 1).padStart(2, '0')}</span></span><span class="song-title">${escape(scoreOf(item)?.title || '악보 없음')}</span></button><div class="queue-actions"><button class="drag-handle" data-drag="${item.id}" aria-label="${index + 1}번 곡 순서 변경" title="드래그하여 순서 변경 · 방향키로 이동"><svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><circle cx="8" cy="5" r="1.8"/><circle cx="16" cy="5" r="1.8"/><circle cx="8" cy="12" r="1.8"/><circle cx="16" cy="12" r="1.8"/><circle cx="8" cy="19" r="1.8"/><circle cx="16" cy="19" r="1.8"/></svg></button><button data-remove="${item.id}" title="콘티에서 제거 · 보관함 파일은 유지" aria-label="${index + 1}번 곡 콘티에서 빼기"> <svg class="remove-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5"/></svg></button></div></li>`).join('');
  updateControls(); refreshPreviews($('queue'));
}
function updateControls() {
  const index = currentIndex();
  $('prev-page').disabled = !documentData || page <= 1;
  $('next-page').disabled = !documentData || page + (isSpread() ? 1 : 0) >= pages;
  $('prev-song').disabled = index <= 0;
  $('next-song').disabled = index < 0 || index >= list().items.length - 1;
  $('zoom-in').disabled = !documentData || zoom >= 2;
  $('zoom-out').disabled = !documentData || zoom <= .5;
  $('zoom-label').textContent = `${Math.round(zoom * 100)}%`;
  $('page-label').textContent = documentData ? `${page}${isSpread() && page < pages ? '–'+Math.min(page+1,pages) : ''} / ${pages}` : '— / —';
  $('perform-page').textContent = $('page-label').textContent;
  $('perform-prev').disabled = $('prev-page').disabled;
  $('perform-next').disabled = $('next-page').disabled;
  $('perform-prev-song').disabled = $('prev-song').disabled;
  $('perform-next-song').disabled = $('next-song').disabled;
  $('perform-title').textContent = `${index >= 0 ? (index+1)+' / '+list().items.length+'곡 · ' : ''}${$('score-title').textContent}`;
}
function drawLibrary() {
  const q = $('search').value.trim().toLocaleLowerCase();
  const scores = state.scores.filter(s => s.title.toLocaleLowerCase().includes(q) && (!favoritesOnly || s.favorite));
  $('library-all').setAttribute('aria-pressed',String(!favoritesOnly));
  $('library-favorites').setAttribute('aria-pressed',String(favoritesOnly));
  $('library-items').innerHTML = scores.length ? scores.map(s => `<div class="library-row"><button class="favorite-toggle" data-favorite="${s.id}" aria-pressed="${Boolean(s.favorite)}" aria-label="${escape(s.title)} 즐겨찾기" title="${s.favorite ? '즐겨찾기 해제' : '즐겨찾기 추가'}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/></svg></button><div class="document-cover" data-preview="${s.id}" aria-hidden="true"><span>${{pdf:"PDF",image:"IMAGE",musicxml:"MUSICXML"}[s.kind]}</span><div class="cover-staves">𝄞<br>──────<br>──────<br>──────</div></div><div class="library-info"><strong>${escape(s.title)}</strong><small>${{pdf:'PDF',image:'이미지',musicxml:'MusicXML'}[s.kind]} · ${(s.bytes / 1024 / 1024).toFixed(1)} MB · 기기에 저장됨</small></div><div class="library-actions"><button data-view="${s.id}">악보 보기</button><button data-add="${s.id}">＋ 담기</button></div></div>`).join('') : '<p class="dialog-note">'+ (q ? '검색 결과가 없습니다.' : favoritesOnly ? '즐겨찾는 악보가 없습니다. 전체 악보에서 별표를 눌러주세요.' : '아직 악보가 없습니다. 다운로드한 파일을 가져오세요.') +'</p>';
  refreshPreviews($('library-items'));
}

function openLibrary() { $('library-status').textContent = '‘악보 보기’로 바로 열거나, ‘담기’로 콘티에 추가하세요.'; drawLibrary(); $('library-dialog').showModal(); }
async function persistList(next) {
  const saved = await api(`/api/playlists/${next.id}`, 'PUT', next);
  state.playlists = state.playlists.map(p => p.id === saved.id ? saved : p); drawLists(); if(viewMode !== 'pages' && currentId && list().items.some(i=>i.id===currentId)) await renderPage();
}
function saveProgress() {
  if (standaloneScore && documentData) { localStorage.setItem('on-eum-solo',JSON.stringify({scoreId:standaloneScore.id,page,zoom})); return; }
  if (!currentId || !documentData) return;
  const data = { itemId: currentId, page, zoom };
  state.progress[listId] = data;
  api(`/api/progress/${listId}`, 'PUT', data).catch(e => toast(e.message));
}
async function addScore(scoreId) {
  const next = structuredClone(list());
  const item = { id: crypto.randomUUID(), scoreId };
  const index = $('insert-position').value === 'after' && currentIndex() >= 0 ? currentIndex() + 1 : next.items.length;
  next.items.splice(index, 0, item);
  await persistList(next);
  if (!currentId && !standaloneScore) await selectItem(item.id);
  $('library-status').textContent = `${scoreOf(item).title} — ${index + 1}번째에 추가했습니다. 현재 악보는 그대로 유지됩니다.`;
}
async function getRenderer() {
  if (!rendererPromise) rendererPromise = Promise.all([import('/vendor/verovio/verovio-module.mjs'), import('/vendor/verovio/verovio.mjs')]).then(async ([module, wrapper]) => ({ module: await module.default(), Toolkit: wrapper.VerovioToolkit }));
  return rendererPromise;
}
function dispose(data) { if (data?.kind === 'pdf') data.task.destroy().catch(() => {}); if (data?.kind === 'musicxml') data.doc.destroy(); }
function clearReader() {
  standaloneScore = null; localStorage.removeItem('on-eum-solo');
  token++; dispose(documentData); documentData = null; currentId = null; pages = 0; page = 1;
  $('score-title').textContent = '콘티에 악보를 추가해 주세요'; $('score-type').textContent = 'LOCAL SCORE READER';
  $('stage').innerHTML = '<div class="empty"><span class="empty-mark">♫</span><h2>오늘의 첫 곡을 골라보세요</h2><p>‘곡 추가’에서 보관한 악보를 담을 수 있어요.</p></div>'; drawLists();
}
async function loadScore(score) {
  const url = `/api/scores/${score.id}/file`; let loaded;
    if (score.kind === 'pdf') {
      const task = pdfjs.getDocument({ url, cMapUrl:'/vendor/pdf/cmaps/', cMapPacked:true, standardFontDataUrl:'/vendor/pdf/standard_fonts/', wasmUrl:'/vendor/pdf/wasm/', isEvalSupported:false });
      let doc; try { doc = await task.promise; } catch (error) { await task.destroy(); throw error; }
      loaded = { kind:'pdf', doc, task, count:doc.numPages };
    } else if (score.kind === 'image') {
      const img = new Image(); img.src = url; await img.decode(); loaded = {kind:'image', img, count:1};
    } else {
      const response = await fetch(url); if (!response.ok) throw new Error('파일을 읽지 못했습니다.'); const xml = await response.text();
      const parsed = new DOMParser().parseFromString(xml,'application/xml'); if (parsed.querySelector('parsererror')) throw new Error('MusicXML 문법을 확인해 주세요.');
      const { module, Toolkit } = await getRenderer(); const doc = new Toolkit(module);
      doc.setOptions({inputFrom:'musicxml', pageWidth:2100, pageHeight:2970, scale:40, adjustPageHeight:false, breaks:'auto', footer:'none', header:'none'});
      if (!doc.loadData(xml) || doc.getPageCount() < 1) { doc.destroy(); throw new Error('MusicXML을 악보로 표시할 수 없습니다. 원본 PDF를 추가해 주세요.'); }
      loaded = {kind:'musicxml', doc, count:doc.getPageCount()};
    }
  return loaded;
}
async function selectItem(id, saved, directScore = null) {
  const item = list().items.find(i => i.id === id); const score = directScore || scoreOf(item); if (!score) return;
  standaloneScore = directScore; if (!directScore) localStorage.removeItem('on-eum-solo');
  const myToken = ++token; const previous = documentData; documentData = null; dispose(previous);
  currentId = id; page = saved?.page || 1; zoom = saved?.zoom || 1; pages = 0;
  $('score-title').textContent = score.title; $('score-type').textContent = `${score.kind.toUpperCase()} · ${directScore ? '단독 보기' : 'LOCAL FILE'}`;
  $('stage').innerHTML = '<div class="loading" role="status">악보를 준비하고 있어요…</div>'; drawLists();
  const url = `/api/scores/${score.id}/file`;
  let loaded;
  try {
    loaded = await loadScore(score);
    if (token !== myToken) { dispose(loaded); return; }
    documentData = loaded; pages = loaded.count; page = Math.min(page, pages); if (isSpread()) page = Math.floor((page-1)/2)*2+1; await renderPage(myToken); saveProgress();
  } catch (error) {
    if (token !== myToken) return;
    dispose(loaded); documentData = null; updateControls();
    $('stage').innerHTML = `<div class="error"><h2>이 악보를 열지 못했어요</h2><p>${escape(error.message)}</p><p>암호가 없는 PDF, 정상 이미지 또는 MusicXML 파일을 사용해 주세요.</p><button id="retry">다시 열기</button></div>`;
    $('retry').onclick = () => selectItem(id, saved, directScore);
  }
}
let renderSerial = 0;
async function renderPage(expectedToken = token) {
  if (!documentData) return; const serial = ++renderSerial, targetPage = page;
  const concert = viewMode !== 'pages' && !standaloneScore && currentId;
  const entries = concert ? [...list().items] : [null];
  const owned = [];
  const elements = [];
  try {
  for (const entry of entries) {
  const score = entry ? scoreOf(entry) : standaloneScore || scoreOf(list().items.find(i=>i.id===currentId));
  const data = entry ? await loadScore(score) : documentData;
  if(entry) owned.push(data);
  if(expectedToken !== token || serial !== renderSerial) return;
  const padding = document.body.classList.contains('performance-mode') ? 12 : innerWidth < 850 ? 24 : 46;
  const availableWidth = Math.max(160, $('stage').clientWidth - padding);
  const availableHeight = Math.max(200, $('stage').clientHeight - padding);
  const scrolling = viewMode !== 'pages';
  const count = scrolling ? data.count : isSpread() && data.count > 1 ? 2 : 1;
  const columns = scrolling ? 1 : count;
  const fitWidth = ratio => (rotated ? Math.min(availableHeight, availableWidth * ratio) : viewMode === 'vertical' ? availableWidth : Math.min((availableWidth - (columns-1)*16)/columns, availableHeight * ratio)) * zoom;
  const firstPage = scrolling ? 1 : targetPage;
  let el, aspect;
    for (let targetPage = firstPage; targetPage <= Math.min(firstPage+count-1,data.count); targetPage++) {
    if (data.kind === 'pdf') {
      const pdfPage = await data.doc.getPage(targetPage); const base = pdfPage.getViewport({scale:1});
      aspect = base.width / base.height; const width = fitWidth(aspect);
      const ratio = Math.min(devicePixelRatio || 1, 2); const viewport = pdfPage.getViewport({scale:width / base.width * ratio});
      el = document.createElement('canvas'); el.width = Math.ceil(viewport.width); el.height = Math.ceil(viewport.height); el.style.width = width+'px'; el.style.height = viewport.height / ratio+'px'; el.setAttribute('aria-label',`${$('score-title').textContent} ${targetPage}페이지`);
      await pdfPage.render({ canvasContext:el.getContext('2d'), viewport }).promise;
      if (targetPage < data.count) data.doc.getPage(targetPage + 1).catch(() => {});
    } else if (data.kind === 'image') { aspect = data.img.naturalWidth / data.img.naturalHeight; el = data.img.cloneNode(); el.className = 'score-image'; el.style.width = fitWidth(data.img.naturalWidth / data.img.naturalHeight)+'px'; el.alt = $('score-title').textContent; }
    else {
      aspect = 2100 / 2970; el = document.createElement('div'); el.className = 'xml-page'; el.style.width = fitWidth(2100 / 2970)+'px';
      const svgDoc = new DOMParser().parseFromString(data.doc.renderToSVG(targetPage), 'image/svg+xml');
      svgDoc.querySelectorAll('script,foreignObject,iframe').forEach(e => e.remove());
      svgDoc.querySelectorAll('*').forEach(e => [...e.attributes].forEach(a => { if (/^on/i.test(a.name) || (/href$/i.test(a.name) && !a.value.startsWith('#'))) e.removeAttribute(a.name); }));
      el.append(document.importNode(svgDoc.documentElement,true));
    }
    if (expectedToken !== token || serial !== renderSerial) return;
    if(rotated) { const shell = document.createElement('div'); shell.className='rotated-page'; const w=parseFloat(el.style.width); shell.style.width=(w/aspect)+'px'; shell.style.height=w+'px'; shell.append(el); el=shell; }
    el.dataset.page = String(targetPage); if(entry) { el.dataset.itemId = entry.id; el.dataset.pageCount = String(data.count); el.setAttribute('aria-label',`${score.title} ${targetPage}페이지`); } elements.push(el);
    }
    if (expectedToken !== token || serial !== renderSerial) return;
    if(entry) { dispose(data); owned.pop(); }
    }
    const scrolling = viewMode !== 'pages';
    const wrapper = document.createElement('div'); wrapper.className = 'page-spread ' + (scrolling ? 'scroll-'+viewMode : ''); wrapper.append(...elements);
    $('stage').classList.toggle('single-page', elements.length === 1); $('stage').replaceChildren(wrapper); $('stage').scrollTop = 0; $('stage').scrollLeft = 0; if(scrolling) scrollToPage(page); updateControls();
  } catch (error) { if (expectedToken === token && serial === renderSerial) { $('stage').innerHTML = '<div class="error">페이지를 표시하지 못했습니다. 곡을 다시 선택해 주세요.</div>'; toast(error.message); } } finally { owned.forEach(dispose); }
}
async function changePage(delta) { if (!documentData) return; const target = page + delta * (isSpread() ? 2 : 1); if (target < 1 || target > pages) return; page = target; updateControls(); saveProgress(); if(viewMode !== 'pages') scrollToPage(page); else await renderPage(); }
async function changeSong(delta) { const index = currentIndex(); if(index < 0) return; const item = list().items[index+delta]; if (item) await selectItem(item.id); }
function activateList(id) { listId = id; localStorage.setItem('on-eum-list',id); const saved = state.progress[id]; const item = list().items.find(i => i.id === saved?.itemId) || list().items[0]; if (item) selectItem(item.id, saved?.itemId === item.id ? saved : undefined); else clearReader(); drawLists(); }
$('library-open').onclick = $('add-song').onclick = $('first-import').onclick = openLibrary;
$('library-close').onclick = () => $('library-dialog').close();
$('search').oninput = drawLibrary;
$('library-all').onclick = () => { favoritesOnly=false; drawLibrary(); };
$('library-favorites').onclick = () => { favoritesOnly=true; drawLibrary(); };
$('files').onchange = () => guarded(async () => {
  const files = [...$('files').files]; if (!files.length) return;
  $('library-status').textContent = '파일을 기기에 복사하고 있습니다…';
  try { const data = new FormData(); files.forEach(file => data.append('files',file)); const added = await api('/api/scores','POST',data); state.scores.push(...added.filter(s => !state.scores.some(old => old.id === s.id))); $('search').value = ''; drawLibrary(); $('library-status').textContent = `${added.length}개 파일을 보관했습니다. ‘담기’를 눌러 콘티에 추가하세요.`; }
  catch (e) { $('library-status').textContent = e.message; throw e; } finally { $('files').value = ''; }
});
$('library-items').onclick = e => { const favorite=e.target.closest('[data-favorite]'); if(favorite) { guarded(async()=>{ const score=state.scores.find(s=>s.id===favorite.dataset.favorite); const saved=await api(`/api/scores/${score.id}/favorite`,'PUT',{favorite:!score.favorite}); state.scores=state.scores.map(s=>s.id===saved.id?saved:s); drawLibrary(); }); return; } const view = e.target.closest('[data-view]'); if (view) { const score = state.scores.find(s => s.id === view.dataset.view); $('library-dialog').close(); selectItem(null, undefined, score); return; } const button = e.target.closest('[data-add]'); if (button) guarded(() => addScore(button.dataset.add)); };
$('queue').onclick = e => {
  const select = e.target.closest('[data-select]'); if (select) { selectItem(select.dataset.select); return; }
  const move = e.target.closest('[data-move]'), remove = e.target.closest('[data-remove]');
  if (move || remove) guarded(async () => {
    const next = structuredClone(list()); const id = move?.dataset.move || remove.dataset.remove; const idx = next.items.findIndex(i => i.id === id);
    if (move) { const dest = idx + Number(move.dataset.direction); if (dest < 0 || dest >= next.items.length) return; [next.items[idx], next.items[dest]] = [next.items[dest], next.items[idx]]; }
    else next.items.splice(idx,1);
    await persistList(next);
    if (remove && currentId === id) { const item = next.items[Math.min(idx,next.items.length-1)]; if (item) await selectItem(item.id); else clearReader(); }
  });
};
$('playlist').onchange = () => activateList($('playlist').value);
function nameDialog(mode) { nameMode = mode; $('name-heading').textContent = mode === 'new' ? '새 콘티' : '콘티 이름 변경'; $('name-input').value = mode === 'new' ? '' : list().name; $('name-dialog').showModal(); $('name-input').focus(); }
$('new-list').onclick = () => nameDialog('new'); $('rename-list').onclick = () => nameDialog('rename'); $('name-cancel').onclick = () => $('name-dialog').close();
$('name-form').onsubmit = e => { e.preventDefault(); guarded(async () => { const name = $('name-input').value.trim(); if (!name) return; if (nameMode === 'new') { const added = await api('/api/playlists','POST',{name}); state.playlists.push(added); activateList(added.id); } else await persistList({...list(),name}); $('name-dialog').close(); }); };
$('prev-page').onclick = () => changePage(-1); $('next-page').onclick = () => changePage(1); $('prev-song').onclick = () => changeSong(-1); $('next-song').onclick = () => changeSong(1);
function changeZoom(delta) { if (!documentData) return; zoom = Math.max(.5,Math.min(2,Math.round((zoom+delta)*10)/10)); updateControls(); renderPage(); saveProgress(); }
$('zoom-in').onclick = () => changeZoom(.1); $('zoom-out').onclick = () => changeZoom(-.1);
$('fullscreen').onclick = async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch { toast('브라우저의 전체 화면 기능을 사용해 주세요.'); } };
document.addEventListener('keydown', e => { if (document.querySelector('dialog[open]') || ['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName)) return; if (['ArrowRight','PageDown','ArrowLeft','PageUp'].includes(e.key)) { e.preventDefault(); if (!e.repeat) changePage(['ArrowRight','PageDown'].includes(e.key) ? 1 : -1); } });
let resizeTimer; window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => renderPage(),200); });
try { state = await api('/api/state'); const remembered = localStorage.getItem('on-eum-list'); listId = state.playlists.find(p => p.id === remembered)?.id || state.playlists[0].id; drawLists(); const solo = JSON.parse(localStorage.getItem('on-eum-solo') || 'null'); const soloScore = state.scores.find(s => s.id === solo?.scoreId); if (soloScore) selectItem(null, solo, soloScore); else if (list().items.length) activateList(listId); } catch (e) { toast(e.message); $('score-title').textContent = '프로그램 연결을 확인해 주세요'; }

$('toggle-sidebar').onclick = () => { const hidden = document.body.classList.toggle('sidebar-hidden'); $('toggle-sidebar').setAttribute('aria-expanded', String(!hidden)); renderPage(); };

async function refreshSource() {
  $('source-files').replaceChildren(); $('source-import').disabled = true;
  const data = await api('/api/source-files');
  $('source-files').innerHTML = data.folders.map(f => `<button class="source-folder" data-folder="${escape(f.path)}">▸ ${escape(f.name)}</button>`).join('') + data.files.map((f,i) => `<label class="source-file"><input type="checkbox" value="${escape(f.name)}" ${f.tooLarge ? 'disabled' : ''}><span>${escape(f.name)}</span><small>${(f.bytes/1024/1024).toFixed(1)} MB${f.tooLarge ? ' · 용량 초과' : ''}</small></label>`).join('');
  $('settings-status').textContent = data.files.length ? `${data.files.length}개 악보가 있습니다. 최대 10개를 선택하세요.` : '지원하는 악보 파일이 없습니다. PDF·JPG·PNG·MusicXML을 넣어주세요.';
}
$('settings-open').onclick = () => guarded(async () => {
  const settings = await api('/api/settings'); $('source-path').value = settings.sourceFolder;
  $('storage-path').textContent = `복사본 저장 위치: ${settings.storageFolder}`;
  $('settings-status').textContent = '폴더 경로를 저장하면 파일 목록이 표시됩니다.';
  $('source-files').replaceChildren(); $('source-import').disabled = true; $('settings-dialog').showModal(); refreshUpdatePanel();
  if (settings.sourceFolder) { try { await refreshSource(); } catch(e) { $('settings-status').textContent = e.message; } }
});
$('settings-close').onclick = () => $('settings-dialog').close();
$('settings-form').onsubmit = e => { e.preventDefault(); guarded(async () => {
  try { const settings = await api('/api/settings','PUT',{sourceFolder:$('source-path').value}); $('source-path').value = settings.sourceFolder; await refreshSource(); }
  catch(e) { $('settings-status').textContent = e.message; }
}); };
$('source-refresh').onclick = () => guarded(async () => { try { await refreshSource(); } catch(e) { $('settings-status').textContent = e.message; } });
$('source-files').onchange = () => { const count = $('source-files').querySelectorAll('input:checked').length; $('source-import').disabled = count < 1 || count > 10; $('settings-status').textContent = `${count}개 선택 · 한 번에 최대 10개`; };
$('source-import').onclick = () => guarded(async () => {
  const names = [...$('source-files').querySelectorAll('input:checked')].map(el => el.value);
  $('source-import').disabled = true; $('settings-status').textContent = '악보를 보관함에 복사하고 있습니다…';
  try {
    const scores = await api('/api/source-import','POST',{names});
    const added = scores.filter(s => !state.scores.some(old => old.id === s.id)); state.scores.push(...added);
    $('settings-status').textContent = `${added.length}개 새 악보를 가져왔습니다. ${scores.length-added.length}개는 이미 보관 중입니다. ‘내 악보’에서 콘티에 담으세요.`;
    $('source-files').querySelectorAll('input:checked').forEach(el => el.checked = false);
  } catch(e) { $('settings-status').textContent = e.message; $('source-import').disabled = false; }
});

$('source-files').onclick = e => { const button = e.target.closest('[data-folder]'); if(button) { $('source-path').value = button.dataset.folder; $('settings-form').requestSubmit(); } };

function syncSpreadButton() { $('spread-toggle').setAttribute('aria-pressed',String(spread)); $('spread-toggle').textContent = spread ? '한 장 보기' : '두 장 보기'; }
syncSpreadButton();
$('spread-toggle').onclick = () => { spread = !spread; localStorage.setItem('on-eum-spread',spread ? '2' : '1'); if(spread) page = Math.floor((page-1)/2)*2+1; syncSpreadButton(); updateControls(); renderPage(); saveProgress(); };

let performanceMode = false, controlsTimer, ownedFullscreen = false, beforePerformance = null;
function showPerformanceControls() {
  if (!performanceMode) return;
  $('performance-controls').hidden = false;
  $('perform-page').textContent = $('page-label').textContent;
  clearTimeout(controlsTimer);
  controlsTimer = setTimeout(() => { if (!$('performance-controls').contains(document.activeElement)) $('performance-controls').hidden = true; },3000);
}
function restoreRotation() {
  if(!rotated) return; rotated=false; ({viewMode,spread,zoom}=beforeRotation); beforeRotation=null;
  $('view-mode').value=viewMode; $('spread-toggle').disabled=viewMode!=='pages'; syncSpreadButton();
  $('perform-rotate').setAttribute('aria-pressed','false'); $('perform-rotate').setAttribute('aria-label','악보 90도 회전');
  if(isSpread()) page=Math.floor((page-1)/2)*2+1;
}
async function exitPerformance() {
  restoreRotation();
  if(beforePerformance) { ({viewMode,zoom}=beforePerformance); beforePerformance=null; }
  $('view-mode').value=viewMode; $('spread-toggle').disabled=viewMode!=='pages';
  performanceMode = false; document.body.classList.remove('performance-mode');
  clearTimeout(controlsTimer); $('performance-controls').hidden = true;
  if (ownedFullscreen && document.fullscreenElement) await document.exitFullscreen().catch(() => {});
  ownedFullscreen = false; renderPage();
}
$('performance').onclick = async () => {
  if (!documentData) { toast('먼저 콘티에서 악보를 열어주세요.'); return; }
  beforePerformance={viewMode,zoom}; viewMode='pages'; zoom=1;
  $('view-mode').value='pages'; $('spread-toggle').disabled=false;
  const savedPage=page;
  performanceMode = true; document.body.classList.add('performance-mode');
  if (!document.fullscreenElement) { try { await document.documentElement.requestFullscreen(); ownedFullscreen = true; } catch { /* The in-window reading mode remains available. */ } }
  await selectItem(currentId,{page:savedPage,zoom:1},standaloneScore); showPerformanceControls(); $('stage').focus();
};
$('perform-exit').onclick = exitPerformance;
$('perform-prev').onclick = async () => { await changePage(-1); showPerformanceControls(); };
$('perform-next').onclick = async () => { await changePage(1); showPerformanceControls(); };
$('stage').addEventListener('click',showPerformanceControls);
document.addEventListener('keydown',e => { if (performanceMode && e.key === 'Escape') { e.preventDefault(); exitPerformance(); } });
document.addEventListener('fullscreenchange',() => { if (performanceMode && ownedFullscreen && !document.fullscreenElement) exitPerformance(); });

function scrollToPage(number) {
  const el = $('stage').querySelector(`${!standaloneScore && currentId ? '[data-item-id="'+currentId+'"]' : ''}[data-page="${number}"]`); if(!el) return;
  const stage = $('stage'), box = el.getBoundingClientRect(), outer = stage.getBoundingClientRect();
  if(viewMode === 'horizontal') stage.scrollLeft += box.left-outer.left-6;
  else stage.scrollTop += box.top-outer.top-6;
}
$('view-mode').value = viewMode;
$('spread-toggle').disabled = viewMode !== 'pages';
$('view-mode').onchange = () => {
  viewMode = $('view-mode').value; localStorage.setItem('on-eum-view-mode',viewMode);
  $('spread-toggle').disabled = viewMode !== 'pages';
  if(isSpread()) page = Math.floor((page-1)/2)*2+1;
  updateControls(); if(viewMode === 'pages' && !standaloneScore && currentId) selectItem(currentId,{page,zoom}); else renderPage(); saveProgress();
};
let scrollTimer;
$('stage').addEventListener('scroll',() => {
  clearTimeout(scrollTimer); if(viewMode === 'pages' || !documentData) return;
  scrollTimer = setTimeout(() => {
    if(viewMode === 'pages' || !documentData) return;
    const stage = $('stage'), outer = stage.getBoundingClientRect();
    const horizontal = viewMode === 'horizontal';
    const center = horizontal ? outer.left+stage.clientWidth/2 : outer.top+stage.clientHeight/2;
    let nearest = null, distance = Infinity;
    stage.querySelectorAll('[data-page]').forEach(el => {
      const rect = el.getBoundingClientRect(); const start = horizontal ? rect.left : rect.top, end = horizontal ? rect.right : rect.bottom;
      const d = center < start ? start-center : center > end ? center-end : 0;
      if(d < distance) { distance = d; nearest = el; }
    });
    if(nearest && (page !== Number(nearest.dataset.page) || (nearest.dataset.itemId && currentId !== nearest.dataset.itemId))) {
      if(nearest.dataset.itemId) { currentId = nearest.dataset.itemId; pages = Number(nearest.dataset.pageCount); const score = scoreOf(list().items.find(i=>i.id===currentId)); $('score-title').textContent=score.title; $('score-type').textContent=score.kind.toUpperCase()+' · 콘티 연속 보기'; }
      page = Number(nearest.dataset.page); drawLists(); saveProgress();
    }
  },100);
});
$('stage').addEventListener('wheel',e => {
  if(viewMode === 'horizontal' && !e.ctrlKey && Math.abs(e.deltaY)>Math.abs(e.deltaX)) { e.preventDefault(); $('stage').scrollLeft += e.deltaY; }
},{passive:false});

$('perform-prev-song').onclick = async () => { await changeSong(-1); showPerformanceControls(); };
$('perform-next-song').onclick = async () => { await changeSong(1); showPerformanceControls(); };

$('perform-rotate').onclick = async () => {
  if (!documentData) return;
  const savedPage = page;
  if(rotated) { restoreRotation(); await renderPage(); }
  else {
    beforeRotation={viewMode,spread,zoom}; rotated=true; viewMode='pages'; spread=false; zoom=1;
    $('view-mode').value='pages'; $('spread-toggle').disabled=false; syncSpreadButton();
    $('perform-rotate').setAttribute('aria-pressed','true'); $('perform-rotate').setAttribute('aria-label','악보 회전 원복');
    await selectItem(currentId,{page:savedPage,zoom:1},standaloneScore);
  }
  updateControls(); showPerformanceControls();
};

let updatePolling;
async function refreshUpdatePanel() {
  try {
    const info=await api('/api/updates');
    $('update-version').textContent=`악보담 ${info.currentVersion}`;
    $('update-repository').value=info.repository;
    const running=['preparing','restarting'].includes(info.job.phase);
    $('update-install').disabled=!info.managed || !info.release?.available || running;
    $('update-rollback').disabled=!info.canRollback || running;
    $('update-check').disabled=running; $('update-backup').disabled=running;
    $('update-repo-form').querySelector('button').disabled=running;
    $('update-backup-path').textContent=info.lastBackup ? `최근 백업: ${info.lastBackup.path}` : '아직 데이터 백업이 없습니다.';
    $('update-status').textContent=info.job.phase!=='idle' ? info.job.message : !info.repository ? '저장소 미연결 · GitHub 저장소 생성 후 주소를 등록하세요.' : info.release?.message || (info.release ? info.release.available ? `새 버전 ${info.release.latest} 설치 가능` : `새 버전 없음 · 최신 태그 ${info.release.latest}` : '정식 버전 태그(v0.1.0 등)를 확인할 수 있습니다.');
    if(running) { clearTimeout(updatePolling); updatePolling=setTimeout(pollUpdate,2000); }
  } catch(e) { $('update-status').textContent=e.message; }
}
async function pollUpdate() {
  try {
    const info=await api('/api/updates');
    if(info.job.phase==='idle') { location.reload(); return; }
    await refreshUpdatePanel();
  } catch { $('update-status').textContent='재시작 중입니다. 잠시 후 다시 연결합니다…'; updatePolling=setTimeout(pollUpdate,2500); }
}
$('update-repo-form').onsubmit=e=>{e.preventDefault(); guarded(async()=>{await api('/api/updates/repository','PUT',{repository:$('update-repository').value});await refreshUpdatePanel();});};
$('update-check').onclick=()=>guarded(async()=>{ $('update-status').textContent='새 버전을 확인하고 있습니다…';try{await api('/api/updates/check','POST');await refreshUpdatePanel();}catch(e){$('update-status').textContent=e.message;} });
$('update-backup').onclick=()=>guarded(async()=>{ $('update-status').textContent='데이터를 백업하고 있습니다…';await api('/api/updates/backup','POST');await refreshUpdatePanel();$('update-status').textContent='악보·콘티·설정 백업을 완료했습니다.'; });
$('update-install').onclick=()=>guarded(async()=>{await api('/api/updates/install','POST');await refreshUpdatePanel();});
$('update-rollback').onclick=()=>guarded(async()=>{await api('/api/updates/rollback','POST');$('update-status').textContent='이전 프로그램으로 재시작합니다…';updatePolling=setTimeout(pollUpdate,2000);});

installQueueDrag($('queue'), {
  snapshot: () => ({listId, ids:list().items.map(item=>item.id)}),
  reset: () => drawLists(),
  commit: (snapshot, ids) => guarded(async () => {
    const current=state.playlists.find(p=>p.id===snapshot.listId);
    if(listId!==snapshot.listId || !current || ids.length!==snapshot.ids.length || new Set(ids).size!==ids.length || ids.some(id=>!snapshot.ids.includes(id)) || current.items.map(i=>i.id).join()!==snapshot.ids.join()) { drawLists(); return; }
    const next={...current,items:ids.map(id=>current.items.find(item=>item.id===id))};
    try { await persistList(next); toast('곡 순서를 변경했습니다.'); }
    catch(error) { drawLists(); throw error; }
  })
});
