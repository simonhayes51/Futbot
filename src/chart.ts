import './font-config.js';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { escapeXml, coins } from './domain.js';
const fontfile=fileURLToPath(new URL('../assets/fonts/DejaVuSans.ttf',import.meta.url));
export type ChartPoint={at:Date;value:number};
export function chartSeries(points:ChartPoint[]){return points.filter(p=>Number.isFinite(p.value)&&p.value>0&&Number.isFinite(p.at.getTime())).sort((a,b)=>a.at.getTime()-b.at.getTime());}
export async function marketChart(title:string,input:ChartPoint[]){
 const points=chartSeries(input);if(points.length<2)return null;
 const values=points.map(p=>p.value),low=Math.min(...values),high=Math.max(...values);
 const padding=Math.max((high-low)*.12,high*.005,1),min=Math.max(0,low-padding),max=high+padding;
 const start=points[0].at.getTime(),end=points.at(-1)!.at.getTime();if(end<=start)return null;
 const x=(at:number)=>108+(at-start)/(end-start)*620,y=(v:number)=>258-(v-min)/(max-min)*142;
 const path=points.map((p,i)=>`${i?'L':'M'}${x(p.at.getTime()).toFixed(2)} ${y(p.value).toFixed(2)}`).join(' ');
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="780" height="370"><rect width="780" height="370" fill="#121c28"/><rect width="780" height="5" fill="#3458ff"/><rect x="24" y="25" width="4" height="42" fill="#ff6b19"/>${[0,1,2,3].map(i=>`<path d="M108 ${116+i*142/3}H728" stroke="#304153"/>`).join('')}<path d="${path} L728 258 L108 258Z" fill="#1638c5" opacity=".22"/><path d="${path}" fill="none" stroke="#ff6b19" stroke-width="3" stroke-linejoin="round"/><circle cx="728" cy="${y(values.at(-1)!)}" r="4" fill="#ff6b19"/><path d="M24 318H756" stroke="#304153"/></svg>`;
 const overlays:sharp.OverlayOptions[]=[];
 async function label(text:string,left:number,top:number,size:number,width:number,colour='#aab9ca'){
  const input=await sharp({text:{text:`<span foreground="${colour}">${escapeXml(text)}</span>`,font:`DejaVu Sans ${size}`,fontfile,rgba:true,dpi:72}}).resize({width,height:size+5,fit:'inside',withoutEnlargement:true}).png().toBuffer();
  overlays.push({input,left,top});
 }
 await label(title.slice(0,64),40,24,21,690,'#f3f5f7');
 await label('HOURLY MEDIAN / OBSERVED LOWEST BIN',40,57,11,690);
 await label('COINS',24,91,10,70);
 for(let i=0;i<4;i++)await label(coins(Math.round(max-(max-min)*i/3)),24,109+Math.round(i*142/3),12,78);
 const date=(ms:number)=>new Date(ms).toLocaleString('en-GB',{timeZone:'UTC',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hour12:false});
 for(let i=0;i<3;i++)await label(date(start+(end-start)*i/2),108+i*242,277,11,145);
 await label('UTC',728,299,9,30);
 await label(`LOW ${coins(low)}    HIGH ${coins(high)}    ${points.length} HOURLY OBSERVATIONS`,24,335,12,730,'#f3f5f7');
 return sharp(Buffer.from(svg)).composite(overlays).png().toBuffer();
}
