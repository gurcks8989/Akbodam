export function installExport({api,getSelection,loadScore,dispose,flushNotes}){
  const $=id=>document.getElementById(id);let prepared=null,working=false,generation=0,timer;
  function status(message){$('export-status').textContent=message;}
  function closeQR(){clearTimeout(timer);$('export-qr').hidden=true;$('export-url').textContent='';return api('/api/export/phone','DELETE').catch(()=>{});}
  function invalidate(){status('범위와 메모 포함 여부를 확인하고 PDF 만들기를 눌러주세요.');prepared=null;$('export-result').hidden=true;$('export-share').disabled=true;closeQR();}
  function busy(value){working=value;for(const id of ['export-prepare','export-scope','export-notes'])$(id).disabled=value;$('export-share').disabled=value||!prepared;}
  $('export-open').onclick=async()=>{
    const selection=getSelection();$('export-scope').querySelector('[value=score]').disabled=!selection.score;$('export-scope').querySelector('[value=playlist]').disabled=!selection.playlist?.items.length;
    $('export-scope').value=selection.score?'score':'playlist';invalidate();$('export-dialog').showModal();status('내보낼 범위와 메모 포함 여부를 선택하세요.');
    try{const data=await api('/api/export/phone');$('export-address').replaceChildren(...data.addresses.map(a=>{const option=document.createElement('option');option.value=a.address;option.textContent=`${a.name} · ${a.address}`;return option;}));}catch(e){status(e.message);}
  };
  $('export-scope').onchange=$('export-notes').onchange=invalidate;
  async function xmlImages(score,form){
    const data=await loadScore(score);
    try{
      if(data.kind==='image'){
        const canvas=document.createElement('canvas');let width=Math.min(2000,data.img.naturalWidth),blob;
        do{canvas.width=width;canvas.height=Math.max(1,Math.round(width*data.img.naturalHeight/data.img.naturalWidth));const context=canvas.getContext('2d');context.fillStyle='white';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(data.img,0,0,canvas.width,canvas.height);blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));width=Math.floor(width*.8);}while(blob?.size>5*1024*1024&&width>400);
        if(!blob||blob.size>5*1024*1024)throw Error('사진을 PDF 페이지로 변환하지 못했습니다.');form.append('pages',blob,`${score.id}-1.png`);return {scoreId:score.id,count:1};
      }
      if(data.count>50)throw Error('MusicXML은 한 번에 50페이지 이하로 내보내 주세요.');
      for(let page=1;page<=data.count;page++){
        status(`${score.title} · ${page} / ${data.count}페이지 준비 중…`);
        const parsed=new DOMParser().parseFromString(data.doc.renderToSVG(page),'image/svg+xml');parsed.querySelectorAll('script,foreignObject,iframe').forEach(el=>el.remove());parsed.querySelectorAll('*').forEach(el=>[...el.attributes].forEach(a=>{if(/^on/i.test(a.name)||(/href$/i.test(a.name)&&!a.value.startsWith('#')))el.removeAttribute(a.name);}));
        const src=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(parsed)],{type:'image/svg+xml'}));
        try{const img=new Image();img.src=src;await img.decode();const canvas=document.createElement('canvas');canvas.width=1600;canvas.height=Math.round(1600*2970/2100);const context=canvas.getContext('2d');context.fillStyle='white';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(img,0,0,canvas.width,canvas.height);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw Error('MusicXML 페이지 이미지 변환에 실패했습니다.');form.append('pages',blob,`${score.id}-${page}.png`);}finally{URL.revokeObjectURL(src);}
      }
      return {scoreId:score.id,count:data.count};
    }finally{dispose(data);}
  }
  $('export-prepare').onclick=async()=>{
    if(working)return;const serial=++generation;busy(true);invalidate();status('내보낼 악보를 준비하고 있습니다…');
    try{
      const selection=getSelection(),scope=$('export-scope').value,includeNotes=$('export-notes').checked;
      const scores=scope==='score'?[selection.score]:selection.playlist?.items.map(i=>selection.scores.find(s=>s.id===i.scoreId));
      if(!scores?.length||scores.some(s=>!s))throw Error('내보낼 악보나 콘티를 선택해 주세요.');
      if(includeNotes)await flushNotes(scores.map(s=>s.id));
      const form=new FormData(),xml=[];for(const score of [...new Map(scores.filter(s=>s.kind==='musicxml'||s.kind==='image').map(s=>[s.id,s])).values()])xml.push(await xmlImages(score,form));
      form.append('options',JSON.stringify({scope,includeNotes,scoreId:selection.score?.id,playlistId:selection.playlist?.id,xml}));status('PDF를 만들고 있습니다…');
      const result=await api('/api/export','POST',form);if(serial!==generation||!$('export-dialog').open)return;
      prepared=result;$('export-summary').textContent=`${result.filename} · ${result.pages}페이지 · ${(result.bytes/1024/1024).toFixed(1)} MB`;
      $('export-local').href=`/api/export/${result.id}/file`;$('export-local').download=result.filename;$('export-result').hidden=false;status('PDF가 준비되었습니다. 저장하거나 QR로 내려받으세요.');
    }catch(e){status(e.message);}finally{busy(false);}
  };
  async function poll(){if(!$('export-dialog').open)return;try{const data=await api('/api/export/phone');if(!data.active){$('export-qr').hidden=true;status('다운로드 접속이 종료되었습니다. QR을 다시 만들 수 있습니다.');return;}}catch(e){status(e.message);}timer=setTimeout(poll,2000);}
  $('export-share').onclick=async()=>{if(!prepared||working)return;if(!$('export-address').value){status('Wi-Fi에 연결한 뒤 내보내기 창을 다시 열어주세요.');return;}busy(true);try{const result=await api(`/api/export/${prepared.id}/phone`,'POST',{address:$('export-address').value});$('export-qr').src=result.qr;$('export-qr').hidden=false;$('export-qr').scrollIntoView({block:'center'});$('export-url').textContent=result.url.split('#')[0];status(`휴대폰으로 QR을 스캔하세요. ${new Date(result.expiresAt).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})}까지 다운로드할 수 있습니다.`);clearTimeout(timer);timer=setTimeout(poll,2000);}catch(e){status(e.message);}finally{busy(false);}};
  $('export-stop').onclick=async()=>{await closeQR();status('다운로드 접속을 종료했습니다.');};
  $('export-close').onclick=()=>$('export-dialog').close();$('export-dialog').addEventListener('close',()=>{generation++;closeQR();});
}
