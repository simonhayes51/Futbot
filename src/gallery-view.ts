import {randomUUID} from 'node:crypto';
import {ActionRowBuilder,ButtonBuilder,ButtonStyle,MessageFlags,type ButtonInteraction,type EmbedBuilder} from 'discord.js';
import type {GalleryValue} from './futgg-context.js';
import type {Card} from './domain.js';
import {coins} from './domain.js';
import {namedCard} from './futgg-cards.js';
import {logFailure} from './logging.js';

const PAGE_SIZE=8;
const clean=(text:string)=>text.replace(/[*_`~|\\<>]/g,'').slice(0,100);
export function galleryPage(tier:GalleryValue,cards:Map<string,Card|null>,page:number){
 const items=[...(tier.items??tier.cardIds.map(id=>({id,price:null})))].sort((a,b)=>(a.price??Infinity)-(b.price??Infinity)||a.id.localeCompare(b.id));
 const pages=Math.max(1,Math.ceil(items.length/PAGE_SIZE));
 page=Math.max(0,Math.min(pages-1,Math.trunc(page)||0));
 const lines=items.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE).map((item,index)=>{
  const card=cards.get(item.id);
  const details=namedCard(card)?(card.versionDetailsMissing?`**${clean(card.name)}**\nVersion details unavailable`:`**${clean(card.name)}**${card.rating===null?'':' · '+card.rating+' OVR'}\n${clean(card.rarity??'Player item')}`):'**Player details unavailable**\nCheck this item on FUT.GG';
  return `${page*PAGE_SIZE+index+1}. ${details} · **${item.price===null?'Price unavailable':coins(item.price)+' coins'}**`;
 });
 const subtotal=items.every(item=>item.price!==null)?items.reduce((sum,item)=>sum+item.price!,0):null;
 return {page,pages,lines,items,subtotal};
}
type Session={owner:string;until:number;tiers:GalleryValue[];brand:()=>EmbedBuilder;resolve:(id:string)=>Promise<Card|null>;cards:Map<string,Card|null>;notice?:string};
const sessions=new Map<string,Session>();
async function render(key:string,session:Session,grade:string,page:number){
 const tier=session.tiers.find(t=>t.grade===grade);if(!tier)throw new Error('Choose an available Gallery tier.');
 const items=tier.items??tier.cardIds.map(id=>({id,price:null}));
 if(items.length!==tier.itemCount)throw new Error('This lineup is incomplete. Check the Gallery on FUT.GG.');
 const view=galleryPage(tier,session.cards,page);
 // Resolve only the visible page; no large burst of external lookups.
 await Promise.all(view.items.slice(view.page*PAGE_SIZE,(view.page+1)*PAGE_SIZE).map(async item=>{
  if(!session.cards.has(item.id))session.cards.set(item.id,await session.resolve(item.id).catch(error=>{logFailure('Gallery item details unavailable',error);return null;}));
 }));
 const final=galleryPage(tier,session.cards,view.page);
 const highest=session.tiers[0].grade;
 const embed=session.brand().setTitle('🏆 '+tier.name).setURL('https://www.fut.gg/gallery/').setDescription(`${session.notice?session.notice+'\n\n':''}**${tier.grade} tier · ${coins(tier.cost??0)} coins estimated**\n${tier.tokens??'—'} tokens · ${tier.coinsPerToken===null?'—':coins(tier.coinsPerToken)} coins per token\n\n**Cards to buy · ${items.length} total**\n${final.lines.join('\n\n')}`)
 .addFields({name:`Page ${final.page+1} of ${final.pages}`,value:`Choose a tier below. ${highest==='S'?'S is the highest tier.':highest+' is the highest tier supplied.'}\nFUT.GG estimates · Console prices · Owned cards are not deducted.`});
 if(final.subtotal!==null&&final.subtotal!==tier.cost)embed.addFields({name:'Price difference',value:`Cards add up to ${coins(final.subtotal)} coins; the set estimate is ${coins(tier.cost??0)}. Check prices before buying.`});
 const tiers=new ActionRowBuilder<ButtonBuilder>().addComponents(session.tiers.map(t=>new ButtonBuilder().setCustomId(`gallery:${key}:tier:${t.grade}:0`).setStyle(t.grade===grade?ButtonStyle.Primary:ButtonStyle.Secondary).setLabel(`${t.grade} tier`).setDisabled(t.grade===grade)));
 const navigation=new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`gallery:${key}:page:${grade}:${final.page-1}`).setStyle(ButtonStyle.Secondary).setLabel('← Previous').setDisabled(final.page===0),new ButtonBuilder().setCustomId(`gallery:${key}:page:${grade}:${final.page+1}`).setStyle(ButtonStyle.Secondary).setLabel('Next →').setDisabled(final.page===final.pages-1));
 return {embeds:[embed],components:final.pages>1?[tiers,navigation]:[tiers],attachments:[],files:[]};
}
export async function startGallery(owner:string,tiers:GalleryValue[],brand:()=>EmbedBuilder,resolve:(id:string)=>Promise<Card|null>,grade?:string|null){
 const order=['S','A','B','C','D'];
 const available=new Map<string,GalleryValue>();
 for(const row of tiers){const grade=row.grade.trim().toUpperCase();if(!order.includes(grade))continue;const current=available.get(grade);if(!current||(row.cost??Infinity)<(current.cost??Infinity))available.set(grade,{...row,grade});}
 tiers=[...available.values()].sort((a,b)=>order.indexOf(a.grade)-order.indexOf(b.grade));
 if(!tiers.length)throw new Error('No priced lineup is available for this set. Try another Gallery.');
 const requested=grade?.trim().toUpperCase();
 const selected=tiers.find(t=>t.grade===requested)?.grade??tiers[0].grade;
 const notice=requested&&requested!==selected?`${requested.replace(/[^A-Z]/g,'').slice(0,12)||'Requested'} tier isn't available. Showing ${selected} instead.`:undefined;
 const key=randomUUID().slice(0,8),session:Session={owner,until:Date.now()+20*60000,tiers,brand,resolve,cards:new Map(),notice};
 for(const [id,s]of sessions)if(s.until<Date.now())sessions.delete(id);
 if(sessions.size>=200)sessions.delete(sessions.keys().next().value!);
 sessions.set(key,session);
 return render(key,session,selected,0);
}
export async function handleGalleryButton(i:ButtonInteraction){
 const [,key,action,grade,pageText]=i.customId.split(':'),session=sessions.get(key);
 if(!session||session.until<Date.now()){sessions.delete(key);await i.reply({content:'This list has expired. Run /gallery to open it again.',flags:MessageFlags.Ephemeral});return;}
 if(i.user.id!==session.owner){await i.reply({content:'Run /gallery to choose your own set and tier.',flags:MessageFlags.Ephemeral});return;}
 if(!['tier','page'].includes(action)||!/^-?\d+$/.test(pageText)||!session.tiers.some(t=>t.grade===grade)){await i.reply({content:'Run /gallery to open a new list.',flags:MessageFlags.Ephemeral});return;}
 session.notice=undefined;
 await i.deferUpdate();await i.editReply(await render(key,session,grade,Number(pageText)));
}
