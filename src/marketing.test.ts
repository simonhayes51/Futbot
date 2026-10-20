import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
async function load(path:string){
 const html=await readFile(new URL(`../dist/${path}index.html`,import.meta.url),'utf8');
 const js=await readFile(new URL('../dist/site.js',import.meta.url),'utf8');
 const dom=new JSDOM(html,{url:`https://futbot.test/${path}`,runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window as any;
 w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
 w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
 w.HTMLElement.prototype.scrollIntoView=function(){};
 w.eval(js);return {dom,w,$:(s:string)=>w.document.querySelector(s)};
}
test('homepage walkthrough and mobile menu respond',async()=>{
 const {dom,$}=await load('');
 assert.match($('h1').textContent,/THE MARKET/);
 $('[data-walk="alert"]').click();assert.match($('#walkthrough').textContent,/Your target/);
 $('[data-walk="watch"]').click();assert.match($('#walkthrough').textContent,/MY SQUAD WATCHLIST/);
 $('.menu-toggle').click();assert.equal($('.menu-toggle').getAttribute('aria-expanded'),'true');
 $('[data-privacy]').click();assert($('#privacy-dialog').hasAttribute('open'));
 dom.window.close();
});
test('pricing shows implemented monthly limits and sponsored seat tiers consistently',async()=>{
 const {dom,w,$}=await load('pricing/');
 assert.match($('#plans').textContent,/£3.99/);
 $('#seat-count').value='100';$('#seat-count').dispatchEvent(new w.Event('change',{bubbles:true}));
 assert.match($('#plans').textContent,/£49.99/);
 assert.match($('#plans').textContent,/25 editable personal price alerts/);assert.equal($('[data-billing="annual"]'),null);
 $('[data-plan="complete"]').click();assert.match($('#chosen-plan').textContent,/100 sponsored seats/);assert.match($('#chosen-description').textContent,/£49.99\/month/);
 assert.match($('#plan-dialog').textContent,/No payment is being taken/);
 dom.window.close();
});
test('command guide filters implemented commands, searches and copies examples',async()=>{
 const {dom,w,$}=await load('commands/');
 assert.equal(w.document.querySelectorAll('.command-card').length,28);
 $('[data-filter="first"]').click();assert.equal(w.document.querySelectorAll('.command-card').length,24);
 $('#command-search').value='/removealert';$('#command-search').dispatchEvent(new w.Event('input',{bubbles:true}));
 assert.equal(w.document.querySelectorAll('.command-card').length,1);
 let copied='';Object.defineProperty(w.navigator,'clipboard',{value:{writeText:async(s:string)=>{copied=s;}}});
 $('[data-copy]').click();await Promise.resolve();assert.equal(copied,'/removealert id:12');
 $('#command-search').value='thisdoesnotexist';$('#command-search').dispatchEvent(new w.Event('input',{bubbles:true}));assert.match($('#commands').textContent,/No commands match/);
 dom.window.close();
});
test('server sponsorship demo models role removal',async()=>{
 const {dom,$}=await load('servers/');$('#role-toggle').click();assert.equal($('#role-toggle').getAttribute('aria-checked'),'false');assert.equal($('#role-status').textContent,'FREE ACCESS');assert.match($('#role-seats').textContent,/16 \/ 25/);$('#role-toggle').click();assert.equal($('#role-status').textContent,'SPONSORED PRO');dom.window.close();
});
test('marketing navigation and local assets point to existing files',async()=>{
 for(const route of ['','pricing/','commands/','servers/']){
  const html=await readFile(new URL(`../dist/${route}index.html`,import.meta.url),'utf8');const dom=new JSDOM(html);
  for(const el of dom.window.document.querySelectorAll('[href],[src]')){
   const url=el.getAttribute('href')||el.getAttribute('src')||'';
   if(!url.startsWith('/'))continue;
   const path=url.split('#')[0].split('?')[0];const file=path.endsWith('/')?path+'index.html':path;
   await access(new URL('../dist'+file,import.meta.url));
  }dom.window.close();
 }
});
