'use strict';
window.FutbotEABrowser=(()=>{
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const cooling=s=>s.rate_limit_until&&new Date(s.rate_limit_until).getTime()>Date.now();
 const cooldownText=s=>cooling(s)?'EA cooldown: '+Math.ceil((new Date(s.rate_limit_until).getTime()-Date.now())/60000)+' minute(s) remaining. Checks stay paused until you restart them.':'';
 const label=s=>!s.online?'Offline':({disconnected:'Not connected',login:'Complete EA login',ready:s.auto_enabled?'Automatic checks enabled':'Connected — checks paused',needs_login:'Reconnect needed',checking:'Checking SBCs and EVOs',paused:'Checks paused',error:'Connection needs attention'}[s.phase]??'Connecting');
 let timer,stopped=false,busy=false,frameAt;
 const stop=()=>{stopped=true;clearTimeout(timer);frameAt=undefined;};
 async function render(api){
  const state=await api('content-watch/browser');
  return `<section class="panel form-panel" id="ea-browser-panel"><div class="panel-head"><h3>Automatic EA connection</h3><span id="ea-browser-state" class="tag">${esc(label(state))}</span></div>
  <p>Connect to the EA web app in your private browser. You can log in and complete verification from this screen on your phone.</p>
  <div class="filterbar"><button class="button primary" data-ea-action="connect" ${state.online?'':'disabled'}>Connect EA</button><button class="button" data-ea-action="scan" ${state.online&&!cooling(state)?'':'disabled'}>Start / check now</button><button class="button" data-ea-action="pause" ${state.online?'':'disabled'}>Pause checks</button><button class="button" data-ea-action="disconnect" ${state.online?'':'disabled'}>Disconnect & forget login</button></div>
  <p id="ea-browser-message" role="status" aria-live="polite">${esc(state.last_error??(state.online?'Tap Connect EA, log in, then press Start / check now.':'The EA browser service is offline. Deploy it before connecting.'))}</p>
  <p id="ea-browser-cooldown" role="status">${esc(cooldownText(state))}</p>
  <small id="ea-browser-last" class="hint">Last authenticated content check: ${state.last_scan_at?esc(new Date(state.last_scan_at).toLocaleString('en-GB')):'not yet'}. EA may require you to reconnect periodically.</small>
  <div id="ea-browser-view" hidden><p class="hint">Tap a field in the image, then use the text box below to type into it. Use Zoom screen if the page is too small.</p>
  <div class="filterbar"><button class="button small" id="ea-zoom">Zoom screen</button><button class="button small" data-ea-action="reload">Reload EA</button><button class="button small" data-ea-action="close">Close view</button></div>
  <div style="max-width:100%;overflow:auto;border:1px solid #b9c3cb;background:#fff"><img id="ea-browser-image" alt="Private EA browser screen — tap to interact" style="display:block;width:100%;max-width:none;cursor:pointer" draggable="false"></div>
  <form id="ea-type-form"><label>Text to type into the selected field<input id="ea-browser-text" type="password" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="1000"></label><label><input id="ea-show-text" type="checkbox"> Show text</label><button class="button" type="submit">Type text →</button></form>
  <div class="filterbar"><button class="button small" data-ea-key="Tab">Tab</button><button class="button small" data-ea-key="Enter">Enter</button><button class="button small" data-ea-key="Backspace">Delete</button><button class="button small" data-ea-key="ControlOrMeta+A">Select all</button><button class="button small" data-ea-scroll="-600">Scroll up</button><button class="button small" data-ea-scroll="600">Scroll down</button></div></div></section>`;
 }
 function bind(api,csrf){
  stop();stopped=false;busy=false;const panel=document.querySelector('#ea-browser-panel');if(!panel)return;
  const message=panel.querySelector('#ea-browser-message'),view=panel.querySelector('#ea-browser-view'),image=panel.querySelector('#ea-browser-image');
  const disable=value=>panel.querySelectorAll('button').forEach(b=>{b.disabled=value;});
  const poll=async()=>{
   if(stopped||!document.contains(panel))return;
   try{const status=await api('content-watch/browser');panel.querySelector('#ea-browser-state').textContent=label(status);panel.querySelector('#ea-browser-last').textContent='Last authenticated content check: '+(status.last_scan_at?new Date(status.last_scan_at).toLocaleString('en-GB'):'not yet');
    if(status.last_error&&!busy)message.textContent=status.last_error;
    panel.querySelector('#ea-browser-cooldown').textContent=cooldownText(status);
    if(!busy){disable(!status.online);panel.querySelector('[data-ea-action="scan"]').disabled=!status.online||cooling(status);}
    if(!view.hidden&&status.online){const frame=await api('content-watch/browser/frame');if(frame.image){image.src=frame.image;frameAt=frame.frameAt;}}
   }catch(e){if(!busy)message.textContent=e.message;}
   if(!stopped)timer=setTimeout(poll,2000);
  };
  async function action(payload){
   if(busy)return;busy=true;disable(true);message.textContent='Waiting for the private browser…';
   try{
    const result=await api('content-watch/browser/command',{method:'POST',headers:{'X-CSRF-Token':csrf},body:JSON.stringify(payload)});let done=false;
    for(let n=0;n<400&&!done;n++){
     if(stopped||!document.contains(panel))return;await new Promise(r=>setTimeout(r,500));const resultState=await api('content-watch/browser/command?id='+encodeURIComponent(result.id));
     if(resultState.state==='failed')throw new Error(resultState.error||'Browser action failed.');done=resultState.state==='done';
    }
    if(!done)throw new Error('The browser is taking longer than expected. Check its status before repeating the action.');
    if(payload.action==='connect'||payload.action==='reload')view.hidden=false;
    if(['close','disconnect','scan'].includes(payload.action)){view.hidden=true;image.removeAttribute('src');frameAt=undefined;}
    message.textContent=payload.action==='scan'?'Content check finished. See connection status for the result.':payload.action==='disconnect'?'Saved browser login removed.':'Browser updated.';
    if(!view.hidden){const frame=await api('content-watch/browser/frame');if(frame.image){image.src=frame.image;frameAt=frame.frameAt;}}
   }catch(e){message.textContent=e.message;}finally{busy=false;disable(false);}
  }
  panel.querySelectorAll('[data-ea-action]').forEach(b=>b.onclick=()=>action({action:b.dataset.eaAction}));
  panel.querySelectorAll('[data-ea-key]').forEach(b=>b.onclick=()=>action({action:'key',key:b.dataset.eaKey}));
  panel.querySelectorAll('[data-ea-scroll]').forEach(b=>b.onclick=()=>action({action:'scroll',delta:Number(b.dataset.eaScroll)}));
  image.onclick=e=>{if(!frameAt)return;const rect=image.getBoundingClientRect();action({action:'click',x:(e.clientX-rect.left)/rect.width,y:(e.clientY-rect.top)/rect.height,frameAt});};
  panel.querySelector('#ea-zoom').onclick=()=>{const zoomed=image.style.width==='1000px';image.style.width=zoomed?'100%':'1000px';panel.querySelector('#ea-zoom').textContent=zoomed?'Zoom screen':'Fit screen';};
  panel.querySelector('#ea-show-text').onchange=e=>{panel.querySelector('#ea-browser-text').type=e.target.checked?'text':'password';};
  panel.querySelector('#ea-type-form').onsubmit=e=>{e.preventDefault();const input=panel.querySelector('#ea-browser-text'),text=input.value;if(!text)return;input.value='';void action({action:'text',text});};
  void poll();
 }
 return {render,bind,stop};
})();
