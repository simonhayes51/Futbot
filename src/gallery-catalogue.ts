import {readFileSync} from 'node:fs';
import type {Card} from './domain.js';

// Small, versioned metadata supplement for items absent from the main catalogue.
// Each record has an exact public source URL. No prices are stored here.
const snapshot=JSON.parse(readFileSync(new URL('../data/gallery-cards.json',import.meta.url),'utf8'));
const records=new Map<string,Card>();
for(const row of snapshot.cards??[]){
 let source:URL;try{source=new URL(row.sourceUrl);}catch{continue;}
 if(source.origin!=='https://www.fut.gg'||!source.pathname.endsWith(`/${row.year}-${row.id}/`)||!/^\d+$/.test(row.id)||!Number.isInteger(row.year)||!Number.isInteger(row.rating)||row.rating<1||row.rating>99||typeof row.name!=='string'||!row.name.trim()||typeof row.rarity!=='string')continue;
 const finish=row.finish==='pristine'?'Pristine Holographic':row.finish==='holographic'?'Holographic':null;
 records.set(`${row.year}:${row.id}`,{id:row.id,name:row.name,rating:row.rating,position:row.position??null,rarity:row.rarity+(finish?' · '+finish:''),club:null,image:null,sourceUrl:source.href});
}
export function verifiedGalleryCard(year:number,id:string):Card|null{
 const card=records.get(`${year}:${id}`);return card?{...card}:null;
}
