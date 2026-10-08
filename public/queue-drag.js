// Pointer events support both a mouse and a touchscreen without HTML drag-and-drop.
export function installQueueDrag(queue, {snapshot, reset, commit}) {
  let drag=null, frame=0;
  const rows=()=>Array.from(queue.querySelectorAll('[data-item]'));
  function place() {
    if(!drag?.moved) return;
    const others=rows().filter(row=>row!==drag.row);
    const before=others.find(row=>{const box=row.getBoundingClientRect();return drag.y<box.top+box.height/2;});
    queue.insertBefore(drag.row,before||null);
  }
  function scroll() {
    if(!drag) return;
    if(drag.moved) {
      const edge=64;
      const dy=drag.y<edge?-12:drag.y>innerHeight-edge?12:0;
      if(dy) {window.scrollBy(0,dy);place();}
    }
    frame=requestAnimationFrame(scroll);
  }
  function end(cancel=false) {
    if(!drag) return;
    const old=drag;drag=null;cancelAnimationFrame(frame);
    queue.classList.remove('is-dragging');old.row.classList.remove('dragging');
    if(queue.hasPointerCapture(old.pointer)) queue.releasePointerCapture(old.pointer);
    const ids=rows().map(row=>row.dataset.item);
    if(cancel) reset();
    else if(old.moved && ids.join()!==old.snapshot.ids.join()) commit(old.snapshot,ids);
  }
  queue.addEventListener('pointerdown',e=>{
    const handle=e.target.closest('[data-drag]');
    if(!handle || drag || e.button!==0 || rows().length<2) return;
    e.preventDefault();handle.focus();
    drag={row:handle.closest('[data-item]'),snapshot:snapshot(),pointer:e.pointerId,y:e.clientY,start:e.clientY,moved:false};
    queue.setPointerCapture(e.pointerId);frame=requestAnimationFrame(scroll);
  });
  queue.addEventListener('pointermove',e=>{
    if(!drag || drag.pointer!==e.pointerId) return;
    drag.y=e.clientY;
    if(Math.abs(drag.y-drag.start)>5) drag.moved=true;
    if(drag.moved) {queue.classList.add('is-dragging');drag.row.classList.add('dragging');place();}
  });
  queue.addEventListener('pointerup',e=>{if(drag?.pointer===e.pointerId)end();});
  queue.addEventListener('pointercancel',()=>end(true));
  queue.addEventListener('lostpointercapture',()=>end(true));
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape' && drag){e.preventDefault();end(true);}
  });
  queue.addEventListener('keydown',e=>{
    const handle=e.target.closest('[data-drag]');
    if(!handle || !['ArrowUp','ArrowDown'].includes(e.key))return;
    e.preventDefault();e.stopPropagation();
    const old=snapshot(),ids=[...old.ids],i=ids.indexOf(handle.dataset.drag),j=i+(e.key==='ArrowUp'?-1:1);
    if(j<0||j>=ids.length)return;
    [ids[i],ids[j]]=[ids[j],ids[i]];
    Promise.resolve(commit(old,ids)).then(()=>queue.querySelector(`[data-drag="${handle.dataset.drag}"]`)?.focus());
  });
  window.addEventListener('blur',()=>end(true));
}
