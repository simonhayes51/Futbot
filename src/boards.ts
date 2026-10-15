import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { escapeXml,coins } from './domain.js';
import type { MarketCard } from './market.js';
import { fodderRows } from './market.js';
const fontfile=fileURLToPath(new URL('../assets/fonts/DejaVuSans.ttf',import.meta.url));
export async function fodderBoard(cards:MarketCard[],rating?:number,year=27){
 const rows=fodderRows(cards,rating),height=145+rows.length*57;
 const max=Math.max(...rows.flatMap(r=>r.cards.slice(0,1).map(c=>c.value)),1);
 const bg=`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="${height}"><rect width="900" height="${height}" fill="#121c28"/><rect width="900" height="5" fill="#3458ff"/>${rows.map((r,i)=>`<rect x="24" y="${97+i*57}" width="852" height="49" fill="${i%2?'#172536':'#1d2b3d'}"/><rect x="24" y="${97+i*57}" width="4" height="49" fill="#ff6b19"/>${r.cards[0]?`<rect x="720" y="${120+i*57}" width="${Math.max(4,110*r.cards[0].value/max)}" height="4" fill="#ff6b19"/>`:''}`).join('')}</svg>`;
 const overlays:sharp.OverlayOptions[]=[];
 async function label(text:string,left:number,top:number,size:number,width:number,color='#f3f5f7'){
 const input=await sharp({text:{text:`<span foreground="${color}">${escapeXml(text)}</span>`,font:`DejaVu Sans ${size}`,fontfile,rgba:true}}).resize({width,height:size+6,fit:'inside',withoutEnlargement:true}).png().toBuffer();overlays.push({input,left,top});}
 await label('FODDER WATCH / THE RATING LADDER',24,24,25,850);await label('CHEAPEST FRESH CARDS BY RATING • CHECK SBC REQUIREMENTS IN GAME',24,62,12,850,'#aab9ca');
 for(let i=0;i<rows.length;i++){const r=rows[i],c=r.cards[0],y=111+i*57;await label(String(r.rating),43,y,20,53,'#ff8640');await label(c?.name??'No fresh price',110,y,17,335);await label(c?coins(c.value)+' coins':'—',468,y,18,190);await label(c?.change!=null?(c.change>=0?'+':'')+c.change.toFixed(1)+'%':'—',735,y-8,13,120,c?.change&&c.change>0?'#83dec9':'#ffad80');}
 await label(`FC${year} / OBSERVED LOWEST BIN / NOT A GUARANTEE OF SBC ELIGIBILITY`,24,height-27,10,850,'#aab9ca');
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
