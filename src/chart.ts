import sharp from 'sharp';
import { escapeXml, coins } from './domain.js';
export async function marketChart(title: string, points: {at:Date;value:number}[]) {
  if (points.length<2) return null;
  const values=points.map(p=>p.value),low=Math.min(...values),high=Math.max(...values),span=high-low||1;
  const path=values.map((p,i)=>`${i?'L':'M'} ${60+i/(values.length-1)*660} ${205-(p-low)/span*125}`).join(' ');
  const start=points[0].at.toISOString().slice(11,16),end=points.at(-1)!.at.toISOString().slice(11,16);
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="780" height="270"><rect width="780" height="270" rx="20" fill="#15191f"/><text x="34" y="35" fill="#f2f6f7" font-size="18" font-family="sans-serif">${escapeXml(title)}</text><text x="34" y="57" fill="#8d9aa5" font-size="11" font-family="sans-serif">Hourly median • observed market prices</text><path d="M60 80H720M60 142H720M60 205H720" stroke="#2c353d"/><path d="${path}" fill="none" stroke="#b7f67b" stroke-width="3"/><text x="60" y="236" fill="#95a2ad" font-family="sans-serif" font-size="11">${start} UTC</text><text x="650" y="236" fill="#95a2ad" font-family="sans-serif" font-size="11">${end} UTC</text><text x="60" y="258" fill="#95a2ad" font-family="sans-serif" font-size="10">Low ${coins(low)} • High ${coins(high)} • ${values.length} hourly observations</text></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
