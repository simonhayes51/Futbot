/* Paste into the EA web-app console. Open SBCs/EVOs once, then run
 * FutbotContentWatch.collect(). Only GET content requests are made.
 * The observed session header stays inside this page and is never exported.
 */
(() => {
  if (location.origin !== 'https://www.ea.com') throw new Error('Run inside the EA web app');
  window.FutbotContentWatch?.stop();
  const proto = XMLHttpRequest.prototype, originalOpen = proto.open, originalHeader = proto.setRequestHeader;
  const targets = new WeakMap();
  let sid, root, running = false;
  proto.open = function(method, url, ...rest) {
    try { const u = new URL(url, location.href); if (method.toUpperCase() === 'GET' && u.origin === 'https://utas.mob.v1.prd.futc-ext.gcp.ea.com' && /^\/ut\/game\/fc\d+\/(academy|sbs)\//.test(u.pathname)) targets.set(this, u); } catch {}
    return originalOpen.call(this, method, url, ...rest);
  };
  proto.setRequestHeader = function(name, value) {
    const u = targets.get(this);
    if (u && name.toLowerCase() === 'x-ut-sid') { sid = value; root = u.origin + u.pathname.match(/^\/ut\/game\/fc\d+/)[0]; }
    return originalHeader.call(this, name, value);
  };
  const stop = () => { if (proto.open === wrappedOpen) proto.open = originalOpen; if (proto.setRequestHeader === wrappedHeader) proto.setRequestHeader = originalHeader; sid = undefined; root = undefined; };
  const wrappedOpen = proto.open, wrappedHeader = proto.setRequestHeader;
  // Only content fields cross the export boundary; no squads, balances or progress.
  const keep = (value, fields) => Object.fromEntries(fields.filter(k => value[k] !== undefined).map(k => [k, value[k]]));
  const sanitize = (path, body) => {
    if (path === '/sbs/hub/v2') return {categories: (body.categories ?? []).map(c => ({categoryId:c.categoryId, sets:(c.sets ?? []).map(s => keep(s,['setId','name','description','challengesCount','repeatabilityMode','releaseTime','combinedChallengeScoreRequirement','awards']))}))};
    if (path.includes('/sbs/setId/')) return {challenges:(body.challenges ?? []).map(s => keep(s,['challengeId','setId','name','description','type','scoreRequirement','elgReq','elgDesc','elgOperation']))};
    return {categories:(body.categories ?? []).map(c=>keep(c,['id','description','slotIds','count'])),slots:(body.slots ?? []).map(s=>({...keep(s,['id','slotName','slotDescription','endTime','endTimePurchaseVisibility','elgReqs','currencies','categoryId','isGkExclusive','isOutfieldExclusive']),levels:(s.levels ?? []).map(l=>({level:l.level,awards:l.awards,objectives:(l.objectives ?? []).map(o=>keep(o,['name','multiplier']))}))}))};
  };
  window.FutbotContentWatch = {stop, async collect() {
    if (!sid || !root) throw new Error('Open SBCs or Evolutions once after installing this collector, then run collect() again');
    if (running) throw new Error('Collection already running'); running = true;
    const documents = []; let requests = 0;
    try {
      const get = async path => {
        if (++requests > 250) throw new Error('Content request limit reached; collection stopped');
        await new Promise(r=>setTimeout(r,250));
        const response = await fetch(root + path,{method:'GET',headers:{'X-UT-SID':sid,accept:'application/json'},credentials:'include',redirect:'error',signal:AbortSignal.timeout(15000)});
        if (!response.ok) throw new Error('EA content request returned HTTP '+response.status+'; collection stopped');
        const body = await response.json(), route = path.split('?')[0];
        documents.push({url:root+route,capturedAt:new Date().toISOString(),body:sanitize(route,body)}); return body;
      };
      const sbcs = await get('/sbs/hub/v2');
      for (const id of new Set((sbcs.categories ?? []).flatMap(c=>(c.sets ?? []).map(s=>s.setId)))) {
        if (!Number.isSafeInteger(id)) throw new Error('Invalid SBC set ID');
        await get('/sbs/setId/'+id+'/challenges');
      }
      const hub = await get('/academy/hub/v2');
      for (const category of hub.categories ?? []) {
        if (!Number.isSafeInteger(category.id) || !Number.isSafeInteger(category.count) || category.count < 0 || category.count > 1000) throw new Error('Invalid EVO category');
        for (let offset=0;offset<category.count;offset+=20) {
          const page = await get('/academy/category/'+category.id+'?offset='+offset+'&count=20&sortOrder=asc&slotStatus=NOT_STARTED');
          if (!(page.slots ?? []).length) break;
        }
      }
      const blob = new Blob([JSON.stringify({capturedAt:new Date().toISOString(),documents},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
      a.href=url;a.download='ea-content-snapshot.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      console.log('Saved SBC/EVO content snapshot. Requests:',requests);
    } finally { running=false; }
  }};
  console.log('Collector ready. Open SBCs or Evolutions, then run FutbotContentWatch.collect(). Run FutbotContentWatch.stop() afterwards.');
})();
