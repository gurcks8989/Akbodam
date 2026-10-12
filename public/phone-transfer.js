export function installPhoneTransfer({api,onReceived,onAdd}) {
  const $=id=>document.getElementById(id);
  let timer,seen=new Set(),current=null,refreshing=false;
  function error(e){$('phone-status').textContent=e.message;}
  function display(data){
    current=data;$('phone-qr').hidden=!data.active;$('phone-stop').hidden=!data.active;
    $('phone-start').textContent=data.active?'새 QR 만들기':'QR 만들기';
    if(data.active){$('phone-qr').src=data.qr;$('phone-url').textContent=data.url.split('#')[0];$('phone-status').textContent=`연결 대기 · ${new Date(data.expiresAt).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})}까지 전송 가능`;}else{$('phone-url').textContent='';$('phone-status').textContent='전송이 꺼져 있습니다. QR 만들기를 눌러 시작하세요.';}
  }
  async function poll(){
    if(!$('phone-dialog').open)return;
    try{const data=await api('/api/phone');if(!data.active){display(data);return;}
      if(data.id!==current?.id){seen.clear();$('phone-received').replaceChildren();display(data);}
      const fresh=data.received.filter(r=>!seen.has(r.id));
      if(fresh.length){await onReceived();for(const item of fresh){seen.add(item.id);const row=document.createElement('li'),text=document.createElement('span'),button=document.createElement('button');text.textContent=item.title+(item.duplicate?' · 기존 악보':' · 저장 완료');button.textContent='현재 콘티에 담기';button.onclick=async()=>{button.disabled=true;try{await onAdd(item.scoreId);button.textContent='콘티에 담았어요';}catch(e){button.disabled=false;error(e);}};row.append(text,button);$('phone-received').prepend(row);}}
    }catch(e){error(e);}finally{if($('phone-dialog').open)timer=setTimeout(poll,1800);}
  }
  $('phone-open').onclick=async()=>{
    $('phone-dialog').showModal();$('phone-status').textContent='Wi-Fi 주소 확인 중…';$('phone-start').disabled=true;
    try{const data=await api('/api/phone');$('phone-address').replaceChildren(...data.addresses.map(a=>{const option=document.createElement('option');option.value=a.address;option.textContent=`${a.name} · ${a.address}`;return option;}));display(data);$('phone-start').disabled=!data.addresses.length;if(!data.addresses.length)$('phone-status').textContent='연결된 네트워크가 없습니다. Wi-Fi에 연결해 주세요.';clearTimeout(timer);poll();}catch(e){error(e);}
  };
  $('phone-start').onclick=async()=>{if(refreshing)return;refreshing=true;$('phone-start').disabled=true;try{const data=await api('/api/phone','POST',{address:$('phone-address').value});seen.clear();$('phone-received').replaceChildren();display(data);}catch(e){error(e);}finally{refreshing=false;$('phone-start').disabled=false;}};
  $('phone-stop').onclick=async()=>{try{display(await api('/api/phone','DELETE'));}catch(e){error(e);}};
  $('phone-close').onclick=()=>$('phone-dialog').close();
  $('phone-dialog').addEventListener('close',()=>{clearTimeout(timer);api('/api/phone','DELETE').then(onReceived).catch(error);$('phone-qr').hidden=true;});
}
