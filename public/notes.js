const NS='http://www.w3.org/2000/svg';
export function installNotes({api,getCurrent,toast}) {
  const $=id=>document.getElementById(id),records=new Map();
  let visible=localStorage.getItem('akbodam-notes-visible')!=='false',editing=false,tool='pen',target=null,gesture=null,clearScope;
  const clone=value=>structuredClone(value);
  function selected(){return target&&[...document.querySelectorAll('.note-overlay')].some(el=>el.dataset.scoreId===target.scoreId&&Number(el.dataset.notePage)===target.page)?target:getCurrent();}
  function record(id){
    if(!records.has(id)){
      const value={pages:{},revision:0,loaded:false,undo:[],redo:[],chain:Promise.resolve(),pending:0,error:null,dirty:false};
      value.ready=api(`/api/scores/${id}/notes`).then(data=>{value.pages=data.pages;value.revision=data.revision;value.loaded=true;return value;}).catch(e=>{value.error=e;throw e;});
      records.set(id,value);
    }
    return records.get(id);
  }
  function path(stroke,height){return stroke.points.map((p,i)=>`${i?'L':'M'}${p[0]*1000},${p[1]*height}`).join(' ')+(stroke.points.length===1?` l.01,0`:'');}
  function draw(svg){
    const value=records.get(svg.dataset.scoreId),strokes=value?.pages[svg.dataset.notePage]||[];
    svg.replaceChildren(...strokes.map(stroke=>{const node=document.createElementNS(NS,'path');node.setAttribute('d',path(stroke,Number(svg.dataset.height)));node.setAttribute('fill','none');node.setAttribute('stroke',stroke.color);node.setAttribute('stroke-width',stroke.width*1000);node.setAttribute('stroke-linecap','round');node.setAttribute('stroke-linejoin','round');node.setAttribute('opacity',stroke.tool==='highlight'?'.32':'1');node.dataset.stroke=stroke.id;return node;}));
    svg.classList.toggle('notes-hidden',!visible);svg.classList.toggle('note-editing',editing&&visible&&Boolean(value?.loaded));
  }
  function redraw(id){document.querySelectorAll('.note-overlay').forEach(svg=>{if(!id||svg.dataset.scoreId===id)draw(svg);});controls();}
  function controls(){
    const item=selected(),value=item&&records.get(item.scoreId);
    $('notes-visible').setAttribute('aria-pressed',String(visible));$('notes-visible').textContent=visible?'메모 표시':'메모 숨김';
    $('notes-edit').setAttribute('aria-pressed',String(editing));$('notes-edit').textContent=editing?'편집 종료':'편집 시작';
    $('note-edit-tools').hidden=!editing;
    $('note-target').textContent=item?`${item.page}페이지`:'';
    $('note-undo').disabled=!value?.undo.length;$('note-redo').disabled=!value?.redo.length;
    $('notes-edit').disabled=!item||!value?.loaded;
    $('note-clear-page').disabled=!item||!value?.loaded;$('note-clear-all').disabled=!item||!value?.loaded;
    $('note-save').textContent=value?.error?'저장 실패':value?.pending?'저장 중…':value?.loaded?'저장됨':'';
    $('note-retry').hidden=!value?.error;
    document.body.classList.toggle('notes-edit-mode',editing&&visible);
    for(const el of document.querySelectorAll('.note-overlay'))el.classList.toggle('note-selected',el.dataset.scoreId===item?.scoreId&&Number(el.dataset.notePage)===item?.page);
  }
  function persist(id){
    const value=record(id),snapshot=clone(value.pages);value.pending++;value.dirty=true;controls();
    value.chain=value.chain.then(async()=>{
      try{const saved=await api(`/api/scores/${id}/notes`,'PUT',{revision:value.revision,pages:snapshot});value.revision=saved.revision;value.error=null;}
      catch(e){value.error=e;toast('메모 저장 실패: '+e.message);}
      finally{value.pending--;value.dirty=Boolean(value.error||value.pending);controls();}
    });
    return value.chain;
  }
  function commit(id,before){const value=record(id);value.undo.push(before);if(value.undo.length>20)value.undo.shift();value.redo=[];redraw(id);persist(id);}
  function point(svg,event){const p=svg.createSVGPoint();p.x=event.clientX;p.y=event.clientY;const ctm=svg.getScreenCTM();if(!ctm)return null;const local=p.matrixTransform(ctm.inverse());return [Math.max(0,Math.min(1,local.x/1000)),Math.max(0,Math.min(1,local.y/Number(svg.dataset.height)))].map(n=>Math.round(n*100000)/100000);}
  function distance(point,a,b,aspect){const p=[point[0],point[1]/aspect],u=[a[0],a[1]/aspect],v=[b[0],b[1]/aspect];const dx=v[0]-u[0],dy=v[1]-u[1],length=dx*dx+dy*dy;const t=length?Math.max(0,Math.min(1,((p[0]-u[0])*dx+(p[1]-u[1])*dy)/length)):0;return Math.hypot(p[0]-u[0]-t*dx,p[1]-u[1]-t*dy);}
  function erase(svg,p){const value=record(svg.dataset.scoreId),key=svg.dataset.notePage,aspect=1000/Number(svg.dataset.height),old=value.pages[key]||[];value.pages[key]=old.filter(s=>!s.points.some((a,i)=>distance(p,a,s.points[Math.max(0,i-1)],aspect)<.018+s.width/2));if(old.length!==value.pages[key].length)gesture.changed=true;draw(svg);}
  function finish(cancel=false){if(!gesture)return;const g=gesture;gesture=null;try{g.svg.releasePointerCapture(g.pointerId);}catch{}
    if(cancel){record(g.scoreId).pages=g.before;redraw(g.scoreId);}else if(g.changed)commit(g.scoreId,g.before);
  }
  function wrap(element,scoreId,page,aspect){
    const shell=document.createElement('div');shell.className='note-page';shell.style.width=element.style.width;shell.style.height=(parseFloat(element.style.width)/aspect)+'px';
    const svg=document.createElementNS(NS,'svg');svg.classList.add('note-overlay');svg.setAttribute('viewBox',`0 0 1000 ${1000/aspect}`);svg.setAttribute('aria-label',`${page}페이지 메모`);svg.dataset.scoreId=scoreId;svg.dataset.notePage=page;svg.dataset.height=1000/aspect;svg.setAttribute('preserveAspectRatio','none');
    shell.append(element,svg);draw(svg);
    record(scoreId).ready.then(()=>{draw(svg);controls();}).catch(e=>toast('메모를 불러오지 못했습니다: '+e.message));
    svg.addEventListener('pointerdown',event=>{
      if(!editing||!visible||!record(scoreId).loaded||gesture||event.button!==0)return;
      event.preventDefault();event.stopPropagation();target={scoreId,page};const p=point(svg,event);if(!p)return;
      const value=record(scoreId);gesture={scoreId,page,svg,pointerId:event.pointerId,before:clone(value.pages),changed:false};svg.setPointerCapture(event.pointerId);
      if(tool==='eraser')erase(svg,p);else{
        const strokes=value.pages[page]||=[];if(strokes.length>=2000){finish(true);toast('메모가 너무 많습니다. 필요 없는 획을 지워주세요.');return;}
        const width={pen:{thin:.0015,medium:.003,thick:.006},highlight:{thin:.012,medium:.02,thick:.035}}[tool][$('note-width').value];
        gesture.stroke={id:crypto.randomUUID(),tool,color:$('note-color').value,width,points:[p]};strokes.push(gesture.stroke);gesture.changed=true;draw(svg);
      }controls();
    });
    svg.addEventListener('pointermove',event=>{if(!gesture||gesture.svg!==svg||gesture.pointerId!==event.pointerId)return;event.preventDefault();const events=event.getCoalescedEvents?.()||[event];for(const sample of events.length?events:[event]){const p=point(svg,sample);if(!p)continue;if(tool==='eraser')erase(svg,p);else{const points=gesture.stroke.points,last=points.at(-1);if(points.length<5000&&Math.hypot(p[0]-last[0],p[1]-last[1])>.0005)points.push(p);}}draw(svg);});
    svg.addEventListener('pointerup',event=>{if(gesture?.pointerId===event.pointerId){event.stopPropagation();finish();}});
    svg.addEventListener('pointercancel',event=>{if(gesture?.pointerId===event.pointerId)finish(true);});
    svg.addEventListener('lostpointercapture',()=>{if(gesture?.svg===svg)finish(true);});
    return shell;
  }
  function open(){const panel=$('note-tools');panel.hidden=!panel.hidden;$('notes-open').setAttribute('aria-expanded',String(!panel.hidden));controls();}
  $('notes-open').onclick=$('perform-notes').onclick=open;
  $('notes-close').onclick=()=>{$('note-tools').hidden=true;$('notes-open').setAttribute('aria-expanded','false');viewing();};
  $('notes-visible').onclick=()=>{finish(true);visible=!visible;if(!visible)editing=false;localStorage.setItem('akbodam-notes-visible',String(visible));redraw();};
  $('notes-edit').onclick=()=>{finish();editing=!editing;if(editing){visible=true;localStorage.setItem('akbodam-notes-visible','true');}redraw();};
  document.querySelectorAll('[data-note-tool]').forEach(button=>button.onclick=()=>{finish();tool=button.dataset.noteTool;for(const b of document.querySelectorAll('[data-note-tool]'))b.setAttribute('aria-pressed',String(b===button));if(tool==='highlight')$('note-color').value='#f3cf43';else if(tool==='pen')$('note-color').value='#e34e54';});
  function history(redo){finish(true);const item=selected();if(!item)return;const value=record(item.scoreId),source=redo?value.redo:value.undo,dest=redo?value.undo:value.redo;if(!source.length)return;dest.push(clone(value.pages));value.pages=source.pop();redraw(item.scoreId);persist(item.scoreId);}
  $('note-undo').onclick=()=>history(false);$('note-redo').onclick=()=>history(true);
  $('note-retry').onclick=()=>{const item=selected();if(item)persist(item.scoreId);};
  function askClear(scope){finish();const item=selected();if(!item)return;clearScope={...item,scope};$('note-clear-heading').textContent=scope==='page'?`${item.page}페이지 메모를 모두 지울까요?`:'이 악보의 모든 페이지 메모를 지울까요?';$('note-clear-dialog').showModal();}
  $('note-clear-page').onclick=()=>askClear('page');$('note-clear-all').onclick=()=>askClear('all');$('note-clear-cancel').onclick=()=>$('note-clear-dialog').close();
  $('note-clear-confirm').onclick=()=>{const item=clearScope;if(!item)return;const value=record(item.scoreId),before=clone(value.pages);if(item.scope==='all')value.pages={};else delete value.pages[item.page];commit(item.scoreId,before);$('note-clear-dialog').close();};
  function viewing(){finish();editing=false;target=null;redraw();}
  function refresh(){if(target&&selected()!==target)target=null;controls();}
  window.addEventListener('beforeunload',event=>{if([...records.values()].some(r=>r.dirty)){event.preventDefault();event.returnValue='';}});
  document.addEventListener('keydown',event=>{if(editing&&event.key==='Escape'&&!document.querySelector('dialog[open]')){finish(true);viewing();}});
  return {wrap,refresh,viewing,beforeRender:()=>finish(),flush:async ids=>{finish();const values=ids.map(id=>records.get(id)).filter(Boolean);await Promise.all(values.map(v=>v.chain));if(values.some(v=>v.dirty||v.error))throw Error('메모 저장을 완료한 뒤 내보내 주세요. 메모 도구에서 다시 저장할 수 있습니다.');}};
}
