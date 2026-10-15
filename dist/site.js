'use strict';
const $=s=>document.querySelector(s);const $$=s=>[...document.querySelectorAll(s)];const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let toastTimer;function toast(s){$('.toast').textContent=s;$('.toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('.toast').classList.remove('show'),3200);}
const nav=$('.site-nav'),menu=$('.menu-toggle');menu.onclick=()=>{const open=nav.classList.toggle('open');menu.setAttribute('aria-expanded',String(open));};
$$('.site-nav a').forEach(a=>{if(a.dataset.nav&&location.pathname.includes('/'+a.dataset.nav))a.classList.add('active');a.addEventListener('click',()=>{nav.classList.remove('open');menu.setAttribute('aria-expanded','false');});});
$$('[data-close]').forEach(b=>b.onclick=()=>b.closest('dialog').close());$$('[data-privacy]').forEach(b=>b.onclick=()=>$('#privacy-dialog').showModal());$$('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}}));
const money=n=>'£'+n.toFixed(2),plans={free:{name:'Free',price:0,desc:'Try the essentials and find your feet.',audience:'FOR EVERY PLAYER',features:['Player price checks','24h price charts','3 personal price alerts','1 watchlist · up to 10 cards'],note:'Planned free limits',button:'Explore for free'},personal:{name:'Personal Pro',price:3.99,desc:'Your own market tools, wherever you play.',audience:'FOR YOUR DISCORD ACCOUNT',features:['50 personal price alerts','10 watchlists · 100 cards each','Longer charts, up to 30 days','Advanced movement alerts','Squad budgets & investment tracking','Private market digests'],note:'Several tools are on the roadmap',button:'Explore Personal Pro'},tools:{name:'Server Tools',price:7.99,desc:'Your community’s information, your identity.',audience:'FOR ONE DISCORD SERVER',features:['Custom server name & embed styling','Up to 5 configured social sources','Feed filters & channel routing','Scheduled market summaries','Role permissions & usage insights'],note:'Does not include member Pro seats',button:'Explore Server Tools'},complete:{name:'Server Complete',price:19.99,desc:'Server tools and personal Pro for your members.',audience:'FOR YOUR WHOLE COMMUNITY',features:['Everything in Server Tools','Up to 15 configured social sources','Personal Pro for sponsored members','Grant access through chosen roles','Sponsored-seat management','Aggregate server usage insights'],note:'Fixed seat allowance · no automatic overages',button:'Explore Server Complete'}};
let billing='monthly',seats='25';const seatPrices={'25':19.99,'100':49.99,'250':99.99};
function monthlyPrice(key){return key==='complete'?seatPrices[seats]:plans[key].price;}
function openPlan(key){const p=plans[key],n=monthlyPrice(key),annual=billing==='annual',price=n===0?'Free':annual?money(n*10)+'/year':money(n)+'/month';$('#chosen-plan').textContent=p.name+(key==='complete'?' · '+seats+' sponsored seats':'');$('#chosen-description').textContent=n===0?'Start with basic player prices, charts and a small number of alerts when live access opens.':`Proposed ${price}${key==='personal'?' for your own Discord account':key==='complete'?' for one server, including its sponsored Pro allowance':' for one server’s admin tools'}. ${annual?'Annual billing is charged upfront.':'Monthly subscription.'}`;$('#plan-dialog').showModal();}
function renderPlans(){const target=$('#plans');if(!target)return;target.innerHTML=Object.entries(plans).map(([key,p])=>{const monthly=monthlyPrice(key),annual=billing==='annual',display=annual?monthly*10/12:monthly;return `<article class="plan ${key==='complete'?'featured':''}">${key==='complete'?'<span class="plan-badge">THE WHOLE SERVER PACKAGE</span>':''}<span class="plan-label">${p.audience}</span><h3>${p.name}</h3><p class="plan-desc">${p.desc}</p>${key==='complete'?`<label class="seat-select">Seats <select id="seat-count" aria-label="Sponsored member seats">${Object.keys(seatPrices).map(s=>`<option value="${s}" ${s===seats?'selected':''}>${s} sponsored members</option>`).join('')}</select></label>`:'<div class="seat-select" aria-hidden="true"></div>'}<div class="plan-price">${monthly===0?'£0':money(display)}<span>${monthly===0?'always':'/ month'}</span></div><div class="plan-billed">${monthly===0?'No subscription needed':annual?`${money(monthly*10)} billed yearly · 2 months free`:'Billed monthly at launch'}</div><button class="btn ${key==='complete'?'primary':'secondary'}" data-plan="${key}">${p.button} ↗</button><div class="plan-features">${p.features.map(f=>`<p>${f}</p>`).join('')}</div><small class="soon">${p.note}</small></article>`;}).join('');$$('[data-plan]').forEach(b=>b.onclick=()=>openPlan(b.dataset.plan));if($('#seat-count'))$('#seat-count').onchange=e=>{seats=e.target.value;renderPlans();};}
$$('[data-billing]').forEach(b=>b.onclick=()=>{billing=b.dataset.billing;$$('[data-billing]').forEach(t=>{const active=t===b;t.classList.toggle('active',active);t.setAttribute('aria-pressed',String(active));});renderPlans();});renderPlans();
const commandData=[
 {
  "name": "/price",
  "category": "prices",
  "status": "first",
  "plan": "Development access",
  "description": "Check an exact card with artwork, latest BIN, freshness, hourly-median chart, tax value and buy/sell target buttons.",
  "example": "/price player:Romeo Lavia 78",
  "options": "player — choose an exact card using autocomplete."
 },
 {
  "name": "/alert",
  "category": "alerts",
  "status": "first",
  "plan": "Development access",
  "description": "Create a private one-shot target that sends a DM when a fresh observed price reaches your number.",
  "example": "/alert player:Romeo Lavia 78 direction:below target:750",
  "options": "player, direction (above/below, including equality), target (whole coins)."
 },
 {
  "name": "/testdm",
  "category": "alerts",
  "status": "first",
  "plan": "Development access",
  "description": "Send a private test notification to check Discord DM delivery.",
  "example": "/testdm",
  "options": "Enable DMs from the server and ensure FutBot is not blocked."
 },
 {
  "name": "/myalerts",
  "category": "alerts",
  "status": "first",
  "plan": "Development access",
  "description": "List your own active, paused, queued or failed targets.",
  "example": "/myalerts",
  "options": "Private results. Alert IDs are used for controls."
 },
 {
  "name": "/removealert",
  "category": "alerts",
  "status": "first",
  "plan": "Development access",
  "description": "Cancel your active, paused or failed alert. Queued notifications cannot be cancelled.",
  "example": "/removealert id:12",
  "options": "id — the numeric ID of an alert belonging to you."
 },
 {
  "name": "/pausealert",
  "category": "alerts",
  "status": "first",
  "plan": "Development access",
  "description": "Pause an active target without deleting it.",
  "example": "/pausealert id:12",
  "options": "id — one of your active alert IDs."
 },
 {
  "name": "/resumealert",
  "category": "alerts",
  "status": "first",
  "plan": "Development access",
  "description": "Resume one of your paused targets.",
  "example": "/resumealert id:12",
  "options": "id — one of your paused alert IDs."
 },
 {
  "name": "/tax",
  "category": "market",
  "status": "first",
  "plan": "Development access",
  "description": "Calculate total profit after 5% EA tax, total tax and mathematical break-even per copy.",
  "example": "/tax buy:25000 sell:30000 quantity:3",
  "options": "buy, sell, optional quantity (1–1,000). Choose a valid market listing increment at or above break-even."
 },
 {
  "name": "/fodder",
  "category": "market",
  "status": "first",
  "plan": "Development access",
  "description": "Get a graphic price ladder and the three cheapest fresh-priced cards at each rating from 83 to 91.",
  "example": "/fodder rating:85",
  "options": "Optional exact rating (75–99). This compares prices, not SBC eligibility."
 },
 {
  "name": "/movers",
  "category": "market",
  "status": "first",
  "plan": "Development access",
  "description": "View the ten largest fresh-priced risers or fallers against an observation 24–25 hours ago.",
  "example": "/movers direction:fallers",
  "options": "Optional direction: risers or fallers. Cards without a comparable baseline are excluded."
 },
 {
  "name": "/budget",
  "category": "market",
  "status": "first",
  "plan": "Development access",
  "description": "Find high-rated cards within a coin budget and optional primary position.",
  "example": "/budget coins:25000 position:CM rating:85",
  "options": "coins, optional position and minimum rating. Not a recommendation or guaranteed profit."
 },
 {
  "name": "/watch",
  "category": "alerts",
  "status": "first",
  "plan": "Development access",
  "description": "Save an exact card to your private cross-device watchlist.",
  "example": "/watch player:Romeo Lavia 78",
  "options": "player — exact card. Current development allowance: up to 100 saved cards."
 },
 {
  "name": "/unwatch",
  "category": "alerts",
  "status": "first",
  "plan": "Development access",
  "description": "Remove a player from your own watchlist.",
  "example": "/unwatch player:Romeo Lavia 78",
  "options": "player — exact card."
 },
 {
  "name": "/watchlist",
  "category": "alerts",
  "status": "first",
  "plan": "Development access",
  "description": "See the first ten fresh-priced items in your private watchlist, with coin prices and movements.",
  "example": "/watchlist",
  "options": "The dashboard shows the full saved list; unavailable prices are withheld."
 },
 {
  "name": "/compare",
  "category": "prices",
  "status": "first",
  "plan": "Development access",
  "description": "Compare two exact cards with artwork, rating, position, BIN, freshness and after-tax sale value.",
  "example": "/compare first:Romeo Lavia 78 second:Christian Witzig 71",
  "options": "first and second — choose exact cards using autocomplete."
 },
 {
  "name": "/dashboard",
  "category": "server",
  "status": "first",
  "plan": "Development access",
  "description": "Open the live member workspace. Server managers also get branding, channel publishing and activity controls.",
  "example": "/dashboard",
  "options": "Requires PUBLIC_URL and dashboard OAuth configuration on the hosting service."
 },
 {
  "name": "/help",
  "category": "server",
  "status": "first",
  "plan": "Development access",
  "description": "Show the full implemented tool menu with usage hints.",
  "example": "/help",
  "options": "No options."
 },
 {
  "name": "/movementalert",
  "category": "alerts",
  "status": "planned",
  "plan": "Roadmap",
  "description": "Percentage-movement targets over a selected time window.",
  "example": "/movementalert",
  "options": "Not implemented. Fixed price targets are available now."
 },
 {
  "name": "/squadbudget",
  "category": "alerts",
  "status": "planned",
  "plan": "Roadmap",
  "description": "A combined squad shopping-list budget target.",
  "example": "/squadbudget",
  "options": "Not implemented."
 },
 {
  "name": "/sales",
  "category": "market",
  "status": "planned",
  "plan": "Roadmap",
  "description": "Sale-level analytics with source freshness and sample sizes.",
  "example": "/sales",
  "options": "Not implemented. Current tools read the player catalogue and BIN history."
 },
 {
  "name": "/feed setup",
  "category": "server",
  "status": "planned",
  "plan": "Roadmap",
  "description": "Automatic external news and X source routing.",
  "example": "/feed setup",
  "options": "Not implemented. Access depends on provider credentials and entitlements."
 },
 {
  "name": "/server pro",
  "category": "server",
  "status": "planned",
  "plan": "Roadmap",
  "description": "Subscription-backed server sponsored seats.",
  "example": "/server pro",
  "options": "Not implemented. Checkout, billing and premium role entitlements are not enabled."
 },
 {
  "name": "/digest setup",
  "category": "server",
  "status": "planned",
  "plan": "Roadmap",
  "description": "Scheduled daily channel summaries.",
  "example": "/digest setup",
  "options": "Not implemented. Admins can manually publish a fresh fodder board now."
 }
];
let filter='all',search='';
function renderCommands(){if(!$('#commands'))return;const list=commandData.filter(c=>(filter==='all'||filter==='first'&&c.status==='first'||c.category===filter)&&[c.name,c.description,c.example,c.options].join(' ').toLowerCase().includes(search.toLowerCase()));$('#command-count').textContent=`${list.length} of ${commandData.length} commands · 17 implemented commands`;$('#commands').innerHTML=list.length?list.map(c=>`<article class="command-card"><div class="command-card-header"><h3>${c.name}</h3><span class="command-status ${c.status==='planned'?'planned':''}">${c.status==='first'?'First build':'Roadmap'}</span></div><p>${c.description}</p><div class="command-example"><code>${esc(c.example)}</code><button data-copy="${esc(c.example)}" aria-label="Copy ${c.name} example">Copy ↗</button></div><div class="command-option"><b>${esc(c.plan)}</b><br>${esc(c.options)}</div></article>`).join(''):'<div class="empty">No commands match. Try a different keyword or category.</div>';$$('[data-copy]').forEach(b=>b.onclick=async()=>{try{await navigator.clipboard.writeText(b.dataset.copy);toast('Command example copied.');}catch{toast('Clipboard unavailable. Select the example text to copy it.');}});}
$$('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;$$('[data-filter]').forEach(t=>{t.classList.toggle('active',t===b);t.setAttribute('aria-pressed',String(t===b));});renderCommands();});if($('#command-search'))$('#command-search').oninput=e=>{search=e.target.value;renderCommands();};renderCommands();
const line='<svg viewBox="0 0 430 100" role="img" aria-label="Illustrative price history"><path d="M0 20H430M0 50H430M0 80H430" stroke="#344b7e" stroke-dasharray="3 5"/><path d="M3 18L25 25L48 19L71 31L94 25L117 40L140 33L163 45L186 40L209 55L232 51L255 66L278 61L301 72L324 64L347 80L370 75L393 85L426 78" fill="none" stroke="#ff5b00" stroke-width="2.5" stroke-linecap="round"/></svg>';
const walks={price:{n:'01 / FIND THE EXACT VERSION',title:'Start with a name.<br>Get the whole picture.',text:'Search a player, choose the correct card and see its price with artwork and a readable trend. Every live result will show when the price was observed.',code:'/price player:Romeo Lavia 78',display:`<div class="demo-display-head"><span>PLAYER PRICE</span><span>FC27 · EXAMPLE</span></div><div class="demo-minirow"><img src="/assets/lavia.webp" alt="Lavia gold card"><div><b>Romeo Lavia</b><small>78 CDM · Gold rare</small></div><div class="demo-bigprice">850<small style="text-align:right">coins</small></div></div><div class="demo-spark">${line}</div><div class="foot">Example prices and history. Actual card artwork.</div>`},watch:{n:'02 / YOUR OWN MARKET RADAR',title:'Keep the cards you want<br>in one place.',text:'Build a squad shopping list or follow your next upgrade. See the cards together, then set individual targets. Watchlist commands are planned; try the local version in the dashboard.',code:'/watch add player:Romeo Lavia 78 list:My squad',display:'<div class="demo-display-head"><span>MY SQUAD WATCHLIST</span><span>ILLUSTRATIVE</span></div><div class="watch-row"><b>Romeo Lavia · 78 CDM</b><span>850 coins</span></div><div class="watch-row"><b>Christian Witzig · 71 LM</b><span>400 coins</span></div><div class="watch-row"><b>Combined price</b><span>1,250 coins</span></div><div class="foot">Save and edit example watchlists in the dashboard demo.</div>'},alert:{n:'03 / YOUR TARGET. YOUR NOTIFICATION.',title:'Let the target<br>come to you.',text:'Choose an at-or-below or at-or-above target. The alert service watches fresh price observations and privately messages you when the condition is met. Live Discord delivery awaits setup.',code:'/alert player:Romeo Lavia 78 direction:below target:750',display:'<div class="demo-display-head"><span>PRIVATE PRICE ALERT</span><span>EXAMPLE MESSAGE</span></div><div style="border-left:3px solid #ff5b00;padding:10px 18px;background:#15366f;border-radius:4px"><span style="font-size:9px;letter-spacing:1.2px;color:#ff5b00">✓ YOUR TARGET WAS REACHED</span><h3 style="font-size:22px;margin-top:13px">Romeo Lavia</h3><p style="font-size:11px;margin-top:8px;color:#b7c8e4">Your target: at or below 750 coins</p><div style="font-size:36px;margin-top:10px;letter-spacing:-1px;color:#f3f4ee">700 <small style="font-size:11px">coins</small></div></div><div class="foot">Sample message. No notification has been sent.</div>'}};
function showWalk(key){if(!$('#walkthrough'))return;const w=walks[key];$('#walkthrough').innerHTML=`<div><div class="walk-number">${w.n}</div><h3>${w.title}</h3><p>${w.text}</p><div class="walk-code">${w.code}</div></div><div class="walk-display">${w.display}</div>`;$$('[data-walk]').forEach(b=>{const on=b.dataset.walk===key;b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on));});}
$$('[data-walk]').forEach(b=>b.onclick=()=>showWalk(b.dataset.walk));showWalk('price');
if($('[data-demo-alert]'))$('[data-demo-alert]').onclick=()=>{showWalk('alert');$('#walkthrough').scrollIntoView({behavior:'smooth',block:'center'});};if($('[data-demo-history]'))$('[data-demo-history]').onclick=()=>{location.href='/app/#players';};if($('[data-demo-watch]'))$('[data-demo-watch]').onclick=()=>{showWalk('watch');$('#walkthrough').scrollIntoView({behavior:'smooth',block:'center'});};
if($('#role-toggle'))$('#role-toggle').onclick=()=>{const on=$('#role-toggle').classList.toggle('on');$('#role-toggle').setAttribute('aria-checked',String(on));$('#role-status').textContent=on?'SPONSORED PRO':'FREE ACCESS';$('#role-seats').textContent=on?'17 / 25 · illustrative':'16 / 25 · illustrative';$('#seat-progress').style.width=on?'68%':'64%';$('#role-explainer').textContent=on?'This member receives sponsored Pro through your server.':'This member keeps free access. Private saved data is retained; sponsored Pro ends.';};
document.addEventListener('keydown',e=>{if(e.key==='/'&&$('#command-search')&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)){e.preventDefault();$('#command-search').focus();}});
