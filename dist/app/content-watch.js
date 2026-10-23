'use strict';
window.FutbotContentWatchUpload=(()=>{
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const when=v=>v?new Date(v).toLocaleString('en-GB'):'Not yet';
 async function render(api){
  const data=await api('content-watch'),poll=data.metadata.lastPublicPollAt,active=poll&&Date.now()-Date.parse(poll)<11*60*1000;
  return `<div class="page-heading"><div><span class="eyebrow">PRIVATE / SBC & EVO MONITOR</span><h1>CONTENT WATCH.</h1><p>Upload a web-app capture to establish your baseline or check new requirements.</p></div></div>
  ${window.FutbotEABrowser?await window.FutbotEABrowser.render(api):''}
  <div class="stats"><article class="stat"><span class="stat-label">BASELINE</span><div class="big-number">${data.ready?'READY':'NOT SET'}</div><small>${data.definitions} content records</small></article>
  <article class="stat"><span class="stat-label">PUBLIC CHECKS</span><div class="big-number">${active?'RUNNING':poll?'CHECK WORKER':'WAITING'}</div><small>Last successful check: ${esc(when(poll))}</small></article>
  <article class="stat"><span class="stat-label">EVO COVERAGE</span><div class="big-number">${data.coverage?`${data.coverage.evoFetched} / ${data.coverage.evoExpected}`:'—'}</div><small>Definitions included in your captures</small></article></div>
  <div class="grid-even"><form id="content-upload-form" class="panel form-panel"><h3>Upload your HAR</h3><p>Select the file you exported from the EA web app. There is no need to move it onto Railway.</p>
  <label>Capture file<input id="content-har" name="har" type="file" accept=".har" required></label><small class="hint">HAR files up to 200 MB. Include response content when exporting.</small>
  <label>How should this capture be used?<select name="mode"><option value="baseline" ${data.ready?'':'selected'}>Set baseline — record without alerts</option><option value="changes" ${data.ready?'selected':''}>Compare — queue alerts for changes</option></select></label>
  <button class="button primary full" type="submit">${data.ready?'Import capture':'Set up baseline'} →</button><progress id="content-upload-progress" max="100" value="0" hidden style="width:100%"></progress><p id="content-upload-status" role="status" aria-live="polite"></p></form>
  <section class="panel form-panel"><h3>Your monitor</h3><p>Once the baseline is ready, the Railway worker checks public files every five minutes and can DM you changes.</p>
  <p class="note">Logged-in SBC and EVO definitions update when you upload a fresh capture. A catalogue clue is not a confirmed upcoming release.</p>
  <p>Last upload: <strong>${esc(when(data.metadata.lastUploadAt))}</strong></p><p>Public sources: <strong>${data.publicSources}</strong> · Pending alerts: <strong>${data.pendingAlerts}</strong></p>
  ${data.ready?'<a class="button" href="/api/content-watch/report" download="sbc-evo-report.md">Download content report ↓</a>':''}<p class="hint">Only extracted content is saved. Raw HAR files, cookies and session headers are discarded.</p></section></div>
  <section class="panel"><div class="panel-head"><h3>Recent changes</h3></div>${data.recent.length?`<div class="table-scroll"><table><thead><tr><th>Content</th><th>Change</th><th>Observed</th></tr></thead><tbody>${data.recent.map(e=>`<tr><td>${esc(e.name)}<small class="muted"> · ${esc(e.kind)}</small></td><td>${esc(e.type)}${e.evidence==='catalogue-text'?' · release unconfirmed':''}</td><td>${esc(when(e.at))}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">No changes recorded yet. Setting a baseline does not send alerts.</p>'}</section>`;
 }
 function bind(csrf,onComplete){
  const form=document.querySelector('#content-upload-form');if(!form)return;
  form.onsubmit=event=>{
   event.preventDefault();const file=form.elements.har.files[0],status=document.querySelector('#content-upload-status'),progress=document.querySelector('#content-upload-progress'),button=form.querySelector('button[type=submit]');
   if(!file){status.textContent='Choose a HAR file first.';return;}if(file.size>200*1024*1024){status.textContent='Choose a file smaller than 200 MB.';return;}
   button.disabled=true;progress.hidden=false;progress.value=0;status.textContent='Uploading your capture…';const xhr=new XMLHttpRequest();
   xhr.open('POST','/api/content-watch/import?mode='+encodeURIComponent(form.elements.mode.value));xhr.setRequestHeader('Content-Type','application/json');xhr.setRequestHeader('X-CSRF-Token',csrf);xhr.timeout=240000;
   xhr.upload.onprogress=e=>{if(e.lengthComputable){progress.value=Math.round(e.loaded/e.total*100);status.textContent=progress.value===100?'Upload received. Reading SBC and EVO content…':`Uploading… ${progress.value}%`;}};
   const fail=message=>{button.disabled=false;status.textContent=message;};
   xhr.onerror=()=>fail('The upload connection failed. Check your connection and try again.');xhr.ontimeout=()=>fail('The upload timed out. Try a smaller capture.');xhr.onabort=()=>fail('Upload cancelled.');
   xhr.onload=()=>{let data;try{data=JSON.parse(xhr.responseText);}catch{fail('The upload could not be completed. Please try again.');return;}if(xhr.status<200||xhr.status>=300){fail(data.error||'Could not import this capture.');return;}
    progress.value=100;button.disabled=false;status.textContent=`${data.baseline?'Baseline saved':'Capture compared'}. ${data.definitions} content records; ${data.changes} changes.`;form.elements.har.value='';onComplete(data);};
   xhr.send(file);
  };
 }
 return {render,bind};
})();
