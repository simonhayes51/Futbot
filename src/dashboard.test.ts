import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';

test('dashboard supports the saved-alert, watchlist, feed and branding workflows',async()=>{
 const html=await readFile(new URL('../dist/app/index.html',import.meta.url),'utf8');
 const code=await readFile(new URL('../dist/app/app.js',import.meta.url),'utf8');
 const dom=new JSDOM(html,{url:'https://futbot.test/',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window as any;
 w.structuredClone=structuredClone;
 w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
 w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
 w.eval(code);
 const $=(s:string)=>w.document.querySelector(s);
 assert.match($('#main').textContent,/A better view/);
 $('button[data-newalert]').click();
 $('#alert-form').elements.target.value='700';
 $('#alert-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 let state=JSON.parse(w.localStorage.getItem('futbot-v1'));assert.equal(state.alerts.length,4);assert.equal(state.alerts[0].target,700);
 const go=(path:string)=>{w.location.hash=path;w.dispatchEvent(new w.HashChangeEvent('hashchange'));};
 go('alerts');$('[data-pause]').click();state=JSON.parse(w.localStorage.getItem('futbot-v1'));assert.equal(state.alerts[0].state,'paused');
 $('[data-delete]').click();state=JSON.parse(w.localStorage.getItem('futbot-v1'));assert.equal(state.alerts.length,3);
 go('players');$('#player-search').value='Witzig';$('#player-search').dispatchEvent(new w.Event('input',{bubbles:true}));assert.equal(w.document.querySelectorAll('.player-tile').length,1);$('.player-tile').click();
 const button=$('[data-watch="263745"]');button.click();state=JSON.parse(w.localStorage.getItem('futbot-v1'));assert(state.watch.includes('263745'));
 go('feeds');const before=state.feeds[0].enabled;$('[data-feed-toggle]').click();state=JSON.parse(w.localStorage.getItem('futbot-v1'));assert.notEqual(state.feeds[0].enabled,before);
 $('#add-feed').click();const f=$('#feed-form');f.elements.name.value='My source';f.elements.source.value='https://example.org/rss';f.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));state=JSON.parse(w.localStorage.getItem('futbot-v1'));assert.equal(state.feeds.length,4);
 go('appearance');const b=$('#brand-form');b.elements.name.value='FUTBank Scout';b.dispatchEvent(new w.Event('input',{bubbles:true}));assert.match($('#preview-name').textContent,/FUTBank Scout/);b.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 state=JSON.parse(w.localStorage.getItem('futbot-v1'));assert.equal(state.brand.name,'FUTBank Scout');
 for(const page of ['overview','players','alerts','watchlist','market','feeds','appearance','health']){go(page);assert($('#main').querySelector('h1'),page+' renders');}
 dom.window.close();
});
