import './font-config.js';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { escapeXml,coins } from './domain.js';
import type { MarketCard } from './market.js';
import { fodderRows } from './market.js';
import type { MiscMarketItem } from './prices.js';
import type { GuildSettings } from './settings.js';
const fontfile=fileURLToPath(new URL('../assets/fonts/DejaVuSans.ttf',import.meta.url));
export async function fodderBoard(cards:MarketCard[],rating?:number,year=27,brand?:{name:string;accent:string;footer:string}){
 const rows=fodderRows(cards,rating),height=145+rows.length*57;
 const max=Math.max(...rows.flatMap(r=>r.cards.slice(0,1).map(c=>c.value)),1);
 const accent=brand&&/^#[0-9a-f]{6}$/i.test(brand.accent)?brand.accent:'#3458ff';
 const bg=`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="${height}"><rect width="900" height="${height}" fill="#121c28"/><rect width="900" height="5" fill="${accent}"/>${rows.map((r,i)=>`<rect x="24" y="${97+i*57}" width="852" height="49" fill="${i%2?'#172536':'#1d2b3d'}"/><rect x="24" y="${97+i*57}" width="4" height="49" fill="#ff6b19"/>${r.cards[0]?`<rect x="720" y="${120+i*57}" width="${Math.max(4,110*r.cards[0].value/max)}" height="4" fill="#ff6b19"/>`:''}`).join('')}</svg>`;
 const overlays:sharp.OverlayOptions[]=[];
 async function label(text:string,left:number,top:number,size:number,width:number,color='#f3f5f7'){
 const input=await sharp({text:{text:`<span foreground="${color}">${escapeXml(text)}</span>`,font:`DejaVu Sans ${size}`,fontfile,rgba:true}}).resize({width,height:size+6,fit:'inside',withoutEnlargement:true}).png().toBuffer();overlays.push({input,left,top});}
 await label(brand?brand.name.toUpperCase()+' / FODDER WATCH':'FODDER WATCH / THE RATING LADDER',24,24,25,850);await label('CHEAPEST FRESH CARDS BY RATING • CHANGE VS ~24H MEDIAN',24,62,12,850,'#aab9ca');
 for(let i=0;i<rows.length;i++){const r=rows[i],c=r.cards[0],y=111+i*57;await label(String(r.rating),43,y,20,53,'#ff8640');await label(c?.name??'No fresh price',110,y,17,335);await label(c?coins(c.value)+' coins':'—',468,y,18,190);await label(c?.change!=null?(c.change>=0?'+':'')+c.change.toFixed(1)+'%':'—',735,y-8,13,120,c?.change&&c.change>0?'#83dec9':'#ffad80');}
 await label(`${brand?brand.footer+' / ':''}FC${year} / OBSERVED LOWEST BIN / CHECK SBC REQUIREMENTS`,24,height-27,10,850,'#aab9ca');
 return sharp(Buffer.from(bg)).composite(overlays).png().toBuffer();
}

export async function tradeReceipt(buy:number,sell:number,quantity:number){
 const net=Math.floor(sell*.95),profit=(net-buy)*quantity,tax=(sell-net)*quantity,breakEven=Math.ceil(buy/.95);
 const svg='<svg xmlns="http://www.w3.org/2000/svg" width="780" height="330"><rect width="780" height="330" fill="#121c28"/><rect width="780" height="5" fill="#3458ff"/><rect x="24" y="28" width="4" height="38" fill="#ff6b19"/><path d="M24 206H756M24 292H756" stroke="#304153"/><rect x="24" y="90" width="732" height="100" fill="#1b2b41"/></svg>';
 const overlay:sharp.OverlayOptions[]=[];
 async function label(t:string,left:number,top:number,size:number,width:number,color='#f3f5f7'){
 const input=await sharp({text:{text:`<span foreground="${color}">${escapeXml(t)}</span>`,font:`DejaVu Sans ${size}`,fontfile,rgba:true}}).resize({width,height:size+6,fit:'inside',withoutEnlargement:true}).png().toBuffer();overlay.push({input,left,top});}
 await label('THE COIN DESK / TRADE RECEIPT',40,28,21,700);await label(`${quantity} COP${quantity===1?'Y':'IES'} / BUY ${coins(buy)} / SELL ${coins(sell)}`,40,58,11,700,'#aab9ca');
 await label('PROFIT AFTER 5% EA TAX',42,105,12,690,'#aab9ca');await label(`${profit>=0?'+':''}${coins(profit)} COINS`,42,132,35,690,profit>=0?'#83dec9':'#ffad80');
 for(const [i,labelText,value]of [[0,'TAX / ALL COPIES',tax],[1,'NET SALE / COPY',net],[2,'BREAK-EVEN / COPY',breakEven]] as const){await label(labelText,24+i*250,224,10,225,'#aab9ca');await label(coins(value),24+i*250,248,22,225);}
 await label('BREAK-EVEN IS MATHEMATICAL / ROUND UP TO A VALID MARKET LISTING INCREMENT',24,308,9,730,'#aab9ca');return sharp(Buffer.from(svg)).composite(overlay).png().toBuffer();
}

export function rankConsumables(items:MiscMarketItem[],direction:'risers'|'fallers'|'all'='all',limit=6){
 const rows=items.filter(item=>Number(item.price)>0&&Number(item.baseline_price)>0).map(item=>({...item,change_pct:(Number(item.price)-Number(item.baseline_price!))/Number(item.baseline_price!)*100}));
 const selected=direction==='risers'?rows.filter(item=>item.change_pct>0).sort((a,b)=>b.change_pct-a.change_pct):direction==='fallers'?rows.filter(item=>item.change_pct<0).sort((a,b)=>a.change_pct-b.change_pct):rows.filter(item=>item.change_pct!==0).sort((a,b)=>Number(a.change_pct<0)-Number(b.change_pct<0)||Math.abs(b.change_pct)-Math.abs(a.change_pct));
 return selected.slice(0,Math.max(1,Math.min(12,limit)));
}
export async function consumablesBoard(items:MiscMarketItem[],platform:string,year=27,brand?:GuildSettings){
 const rises=rankConsumables(items,'risers',6),falls=rankConsumables(items,'fallers',6),height=590;
 const accent=brand&&/^#[0-9a-f]{6}$/i.test(brand.accent)?brand.accent:'#3458ff';
 const bg=`<svg xmlns="http://www.w3.org/2000/svg" width="960" height="${height}"><rect width="960" height="${height}" fill="#121c28"/><rect width="960" height="5" fill="${accent}"/><rect x="24" y="105" width="444" height="420" rx="10" fill="#172536"/><rect x="492" y="105" width="444" height="420" rx="10" fill="#172536"/><rect x="24" y="105" width="444" height="4" fill="#65d7a4"/><rect x="492" y="105" width="444" height="4" fill="#ff8459"/></svg>`;
 const overlays:sharp.OverlayOptions[]=[];
 async function label(text:string,left:number,top:number,size:number,width:number,color='#f3f5f7'){
  const input=await sharp({text:{text:`<span foreground="${color}">${escapeXml(text)}</span>`,font:`DejaVu Sans ${size}`,fontfile,rgba:true}}).resize({width,height:size+8,fit:'inside',withoutEnlargement:true}).png().toBuffer();overlays.push({input,left,top});
 }
 const tag=(type:string)=>type==='manager'?'MANAGER':type==='manager_league'?'LEAGUE':'CHEM STYLE';
 const row=async(item:typeof rises[number]|undefined,left:number,top:number)=>{
  if(!item){await label('No qualifying movement yet',left+14,top+12,13,390,'#aab9ca');return;}
  const name=item.display_name||(`${tag(item.item_type)} #${item.item_id}`);
  await label(name,left+14,top+8,15,245);
  await label(tag(item.item_type),left+14,top+32,9,170,'#aab9ca');
  await label(coins(Number(item.price)),left+266,top+11,13,94,'#f3f5f7');
  await label((item.change_pct>0?'+':'')+item.change_pct.toFixed(1)+'%',left+362,top+11,13,67,item.change_pct>=0?'#83dec9':'#ffad80');
 };
 await label((brand?.name??'FUTBOT').toUpperCase()+' / CONSUMABLES MARKET',26,24,24,900);
 await label(`TOP 24-HOUR MOVES • ${platform.toUpperCase()} • FC${year}`,26,61,12,900,'#aab9ca');
 await label('BIGGEST RISES',42,123,14,390,'#83dec9');
 await label('BIGGEST DROPS',510,123,14,390,'#ffad80');
 for(let i=0;i<6;i++){const y=157+i*59;await row(rises[i],42,y);await row(falls[i],510,y);}
 await label(`${brand?.footer??'FutBot'} • Observed lowest BIN vs median observation from 24–25h ago • Check in-game`,26,height-34,10,910,'#aab9ca');
 return sharp(Buffer.from(bg)).composite(overlays).png().toBuffer();
}
