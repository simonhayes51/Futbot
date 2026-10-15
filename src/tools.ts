import {SlashCommandBuilder,AttachmentBuilder,ActionRowBuilder,ButtonBuilder,ButtonStyle,EmbedBuilder,type ChatInputCommandInteraction} from 'discord.js';
import type {MarketService,MarketCard} from './market.js';
import {fodderRows,movers} from './market.js';
import {fodderBoard} from './boards.js';
import {watch,watched} from './settings.js';
import type {AlertRepository} from './alerts.js';
import type {Card} from './domain.js';
import {coins,isFresh} from './domain.js';
const player=(o:any)=>o.setName('player').setDescription('Choose an exact card').setRequired(true).setAutocomplete(true);
export const extraCommands=[
 new SlashCommandBuilder().setName('fodder').setDescription('🧱 Cheapest fresh cards by rating, with a visual price ladder').addIntegerOption(o=>o.setName('rating').setDescription('Optional exact rating, e.g. 85').setMinValue(75).setMaxValue(99)),
 new SlashCommandBuilder().setName('movers').setDescription('📈 Biggest rises or falls against an observation near 24 hours ago').addStringOption(o=>o.setName('direction').setDescription('Market direction').addChoices({name:'📈 Risers',value:'risers'},{name:'📉 Fallers',value:'fallers'})),
 new SlashCommandBuilder().setName('budget').setDescription('💎 Fresh-priced players within your coin budget').addIntegerOption(o=>o.setName('coins').setDescription('Maximum price').setRequired(true).setMinValue(1).setMaxValue(15000000)).addStringOption(o=>o.setName('position').setDescription('Primary position, e.g. ST or CM').setMaxLength(4)).addIntegerOption(o=>o.setName('rating').setDescription('Minimum rating').setMinValue(75).setMaxValue(99)),
 new SlashCommandBuilder().setName('watch').setDescription('⭐ Save a card to your private watchlist').addStringOption(player),
 new SlashCommandBuilder().setName('unwatch').setDescription('Remove a card from your private watchlist').addStringOption(player),
 new SlashCommandBuilder().setName('watchlist').setDescription('⭐ Your saved players with fresh prices and movements'),
 new SlashCommandBuilder().setName('compare').setDescription('⚖️ Compare two exact cards and their market prices').addStringOption(o=>player(o).setName('first')).addStringOption(o=>player(o).setName('second')),
 new SlashCommandBuilder().setName('pausealert').setDescription('⏸ Pause one of your active price alerts').addStringOption(o=>o.setName('id').setDescription('Your alert ID').setRequired(true)),
 new SlashCommandBuilder().setName('resumealert').setDescription('▶️ Resume one of your paused price alerts').addStringOption(o=>o.setName('id').setDescription('Your alert ID').setRequired(true)),
 new SlashCommandBuilder().setName('dashboard').setDescription('🎛 Open your live FutBot dashboard'),
 new SlashCommandBuilder().setName('help').setDescription('📖 All FutBot tools and how to use them')
];
export function cardLines(cards:MarketCard[]){return cards.slice(0,10).map((c,i)=>`**${String(i+1).padStart(2,'0')} · ${c.name.replace(/[*_`~|\\]/g,'')}** · ${c.rating??'—'} ${c.position??''}\n🪙 **${coins(c.value)}**${c.change===null?'':` · ${c.change>=0?'📈 +':'📉 '}${c.change.toFixed(1)}%`}`).join('\n\n')||'No fresh prices match. Try a different filter or check the collector.';}
export async function handleTool(i:ChatInputCommandInteraction,market:MarketService,repo:AlertRepository,brand:()=>EmbedBuilder,resolve:(id:string)=>Promise<Card>){
 const year=market.prices.year,platform=market.platform;
 if(i.commandName==='fodder'){
 const rating=i.options.getInteger('rating')??undefined,cards=await market.snapshot(),rows=fodderRows(cards,rating);
 const embed=brand().setTitle('🧱 FODDER WATCH').setDescription('The cheapest fresh cards for each rating. Check rarity and SBC requirements before buying.').setImage('attachment://fodder.png');
 const cover=rows.find(r=>r.cards[0]?.image)?.cards[0];if(cover?.image?.startsWith('https://'))embed.setThumbnail(cover.image);
 for(const row of rows)embed.addFields({name:`${row.rating} RATED`,value:row.cards.length?row.cards.map(c=>`**${c.name.slice(0,55)}** — ${coins(c.value)} 🪙`).join('\n'):'No fresh price',inline:true});
 await i.editReply({embeds:[embed],files:[new AttachmentBuilder(await fodderBoard(cards,rating,year),{name:'fodder.png'})]});return;
 }
 if(i.commandName==='movers'||i.commandName==='budget'){
 let cards=await market.snapshot();let title='📈 MARKET RISERS';
 if(i.commandName==='movers'){const direction=i.options.getString('direction')??'risers';cards=movers(cards,direction);title=direction==='fallers'?'📉 MARKET FALLERS':title;}
 else{const budget=i.options.getInteger('coins',true),position=i.options.getString('position')?.toUpperCase(),rating=i.options.getInteger('rating')??75;cards=cards.filter(c=>c.value<=budget&&(c.rating??0)>=rating&&(!position||c.position===position)).sort((a,b)=>(b.rating??0)-(a.rating??0)||a.value-b.value).slice(0,10);title=`💎 UNDER ${coins(budget)} COINS`;}
 const embed=brand().setTitle(title).setDescription(cardLines(cards)).addFields({name:'READING THE MARKET',value:'80+ rated items from 1,000 coins. Fresh BIN vs the median of at least three observations 24–25 hours ago. Large swings need verifying in-game.'});if(cards[0]?.image?.startsWith('https://'))embed.setThumbnail(cards[0].image);await i.editReply({embeds:[embed]});return;
 }
 if(['watch','unwatch'].includes(i.commandName)){const c=await resolve(i.options.getString('player',true));if(i.commandName==='watch')await watch(repo.pool,i.user.id,c.id,year,platform);else await repo.pool.query('DELETE FROM futbot_watchlist WHERE user_id=$1 AND card_id=$2 AND game_year=$3 AND platform=$4',[i.user.id,c.id,year,platform]);await i.editReply({embeds:[brand().setTitle(i.commandName==='watch'?'⭐ ADDED TO WATCHLIST':'REMOVED FROM WATCHLIST').setDescription(`${c.name} · Your watchlist is private.\nUse /watchlist to see your saved cards.`)]});return;}
 if(i.commandName==='watchlist'){const ids=await watched(repo.pool,i.user.id,year,platform),cards=await market.snapshot();await i.editReply({embeds:[brand().setTitle('⭐ YOUR WATCHLIST').setDescription(cardLines(cards.filter(c=>ids.includes(c.id)).slice(0,10))).addFields({name:'SAVED CARDS',value:`${ids.length}/100 saved · First 10 fresh-priced cards shown. Full list in the dashboard. Stale or unavailable prices are omitted.`})]});return;}
 if(i.commandName==='compare'){const cards=await Promise.all(['first','second'].map(n=>resolve(i.options.getString(n,true))));const embeds=[];for(const c of cards){const p=await market.prices.latest(c.id,platform);const e=brand().setTitle(`⚖️ ${c.name} · ${c.rating??'—'} ${c.position??''}`).setDescription(`${c.rarity??'Player item'} · ${c.club??'—'}`).addFields({name:'LOWEST BIN',value:p?coins(p.value)+' coins':'Unavailable',inline:true},{name:'PRICE STATUS',value:p?`${isFresh(p.capturedAt,market.maxAge)?'🟢 Fresh':'🟠 Stale'} · <t:${Math.floor(p.capturedAt.getTime()/1000)}:R>`:'No observation',inline:true},{name:'AFTER TAX',value:p?coins(Math.floor(p.value*.95))+' coins':'—',inline:true});if(c.image?.startsWith('https://'))e.setThumbnail(c.image);embeds.push(e);}await i.editReply({embeds});return;}
 if(['pausealert','resumealert'].includes(i.commandName)){const id=i.options.getString('id',true);if(!/^\d+$/.test(id))throw new Error('Enter a numeric alert ID.');const pause=i.commandName==='pausealert';const r=await repo.pool.query('UPDATE futbot_alerts SET state=$1 WHERE user_id=$2 AND id=$3 AND state=$4 RETURNING id',[pause?'paused':'active',i.user.id,id,pause?'active':'paused']);await i.editReply(r.rowCount?`✅ Alert #${id} ${pause?'paused':'resumed'}.`:'No matching alert in the required state belongs to you.');return;}
 if(i.commandName==='dashboard'){const url=process.env.PUBLIC_URL;if(!url){await i.editReply('Your dashboard URL has not been configured yet. Set PUBLIC_URL on the bot service.');return;}await i.editReply({embeds:[brand().setTitle('🎛 YOUR FUTBOT CONTROL ROOM').setDescription('Your watchlist, personal targets and live market tools. Server managers also get branding, publishing and activity controls.')],components:[new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setLabel('Open FutBot').setStyle(ButtonStyle.Link).setURL(new URL('/app/',url).href))]});return;}
 if(i.commandName==='help')await i.editReply({embeds:[brand().setTitle('📖 YOUR ULTIMATE TEAM TOOLKIT').setDescription('🪙 **Prices** · /price · /compare · /tax\n🧱 **Fodder** · /fodder rating:85\n📈 **Market** · /movers · /budget\n⭐ **Watchlist** · /watch · /watchlist · /unwatch\n🔔 **Targets** · /alert · /myalerts · /removealert\n⏯ **Controls** · /pausealert · /resumealert · /testdm\n🎛 **Dashboard** · /dashboard\n\nPrices are observed market data, not guaranteed listings or profit.') ]});
}
