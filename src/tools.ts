import {SlashCommandBuilder,AttachmentBuilder,ActionRowBuilder,StringSelectMenuBuilder,ButtonBuilder,ButtonStyle,EmbedBuilder,type ChatInputCommandInteraction} from 'discord.js';
import type {MarketService,MarketCard} from './market.js';
import {fodderRows,movers} from './market.js';
import {fodderBoard,consumablesBoard,rankConsumables} from './boards.js';
import {watch,watchedMarkets,guildSettings} from './settings.js';
import type {AlertRepository} from './alerts.js';
import type {Card} from './domain.js';
import {coins,isFresh} from './domain.js';
import {fetchFutggContext} from './futgg-context.js';
const player=(o:any)=>o.setName('player').setDescription('Choose an exact card').setRequired(true).setAutocomplete(true);
export const extraCommands=[
 new SlashCommandBuilder().setName('fodder').setDescription('🧱 Cheapest fresh cards by rating, with a visual price ladder'),
 new SlashCommandBuilder().setName('evolutions').setDescription('🧬 Open Evolutions with eligible cards and fresh prices').addStringOption(o=>o.setName('market').setDescription('Price market for card candidates').addChoices({name:'Console',value:'ps5'},{name:'PC',value:'pc'})),
 new SlashCommandBuilder().setName('gallery').setDescription('🏆 FUT.GG Gallery tiers ranked by coins per token'),
 new SlashCommandBuilder().setName('consumables').setDescription('🧴 Top consumable price rises and drops').addStringOption(o=>o.setName('market').setDescription('Choose the price market').addChoices({name:'Console',value:'ps5'},{name:'PC',value:'pc'})).addStringOption(o=>o.setName('category').setDescription('Limit the board to a category').addChoices({name:'All consumables',value:'all'},{name:'Managers',value:'manager'},{name:'Manager leagues',value:'manager_league'},{name:'Chemistry styles',value:'chemistry_style'})).addIntegerOption(o=>o.setName('rating').setDescription('Optional exact rating, e.g. 85').setMinValue(75).setMaxValue(99)),
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
export async function handleTool(i:ChatInputCommandInteraction,market:MarketService,repo:AlertRepository,brand:(pricePlatform?:string)=>EmbedBuilder,resolve:(id:string)=>Promise<Card>,limits={watch:20}){
 const year=market.prices.year,platform=market.platform;
 if(i.commandName==='evolutions'){
  const selectedPlatform=i.options.getString('market')??platform;
  if(!['ps5','pc'].includes(selectedPlatform))throw new Error('Choose Console or PC.');
  const context=await fetchFutggContext(year),rows=context.evolutions.slice(0,7);
  if(!rows.length){await i.editReply({embeds:[brand().setTitle('🧬 NO OPEN EVOLUTIONS').setDescription('FUT.GG currently lists no open Evolutions for this game year.')]});return;}
  const lines=await Promise.all(rows.map(async evo=>{
   const ids=[...evo.eligibleCardIds.slice(0,2).map(id=>({id,reason:'eligible'})),...evo.trendingCardIds.slice(0,1).map(id=>({id,reason:'trending'}))];
   const candidates=await Promise.all(ids.map(async entry=>{
    const card=await market.prices.card(entry.id);
    const price=card?await market.prices.latest(card.id,selectedPlatform):null;
    const fresh=!!price&&isFresh(price.capturedAt,market.maxAge);
    const priceLabel=fresh?coins(price!.value)+' coins':price?`stale · last seen <t:${Math.floor(price.capturedAt.getTime()/1000)}:R>`:'no price data';
    return `• ${card?`${card.name} · ${card.rating??'—'} OVR`:`Card ${entry.id}`} (${entry.reason}) · ${priceLabel}`;
   }));
   const cost=evo.coinsCost!==null?coins(evo.coinsCost)+' coins':evo.pointsCost!==null?evo.pointsCost+' points':'cost not listed';
   const date=Math.floor(Date.parse(evo.closesAt)/1000);
   return `**${evo.name}** · ${cost} · closes <t:${date}:R>\n${candidates.join('\n')||'No card candidates listed'} · ${evo.eligibleCardIds.length} eligible listed`;
  }));
  const embed=brand(selectedPlatform).setTitle('🧬 OPEN EVOLUTIONS').setDescription(lines.join('\n\n').slice(0,4000)).addFields({name:'PRICE CHECK',value:'Prices come from Futbot’s existing price feed and are labelled when fresh. Trending cards are not confirmed as eligible.'});
  await i.editReply({embeds:[embed]});return;
 }
 if(i.commandName==='gallery'){
  const context=await fetchFutggContext(year),rows=context.gallery.filter(row=>row.coinsPerToken!==null).slice(0,8);
  if(!rows.length){await i.editReply({embeds:[brand().setTitle('🏆 GALLERY DATA UNAVAILABLE').setDescription('FUT.GG returned no Gallery tiers with a positive cost and token reward.')]});return;}
  const lines=await Promise.all(rows.map(async row=>{
   const cards=await Promise.all(row.cardIds.map(id=>market.prices.card(id)));
   const named=cards.filter((card):card is Card=>!!card&&!!card.name?.trim()&&!/^unknown(?: card| player)?$/i.test(card.name.trim()));
   const names=named.slice(0,3).map(card=>card.name).join(', '),unresolved=Math.max(0,row.itemCount-named.length);
   return `**${row.name} · ${row.grade}**\n${row.cost===null?'Cost missing':coins(row.cost)+' coins'} / ${row.tokens??'—'} tokens = **${coins(row.coinsPerToken!)} per token**\n${row.itemCount} cards${names?` · ${names}`:''}${unresolved?` · ${unresolved} names unavailable`:''}`;
  }));
  const embed=brand().setTitle('🏆 GALLERY VALUE').setDescription(lines.join('\n\n').slice(0,4000)).addFields({name:'HOW TO READ THIS',value:'Ranked by listed Gallery cost per token. Card names are examples from the tier lineup. Check the in-game requirements and current prices before spending.'});
  await i.editReply({embeds:[embed]});return;
 }
 if(i.commandName==='fodder'){
 const rating=i.options.getInteger('rating')??undefined,cards=await market.snapshot(),rows=fodderRows(cards,rating);
 const embed=brand().setTitle('🧱 FODDER WATCH').setDescription(rating?'Three fresh-priced alternatives at this rating. Check rarity and SBC requirements before buying.':'Cheapest fresh card at each rating. Use /fodder rating:85 for up to three alternatives. Check SBC requirements in-game.').setImage('attachment://fodder.png');
 const cover=rows.find(r=>r.cards[0]?.image)?.cards[0];if(cover?.image?.startsWith('https://'))embed.setThumbnail(cover.image);
 for(const row of rows)embed.addFields({name:`${row.rating} RATED`,value:row.cards.length?row.cards.slice(0,rating?3:1).map(c=>`**${c.name.slice(0,55)}** — ${coins(c.value)} 🪙`).join('\n'):'No fresh price',inline:true});
 await i.editReply({embeds:[embed],files:[new AttachmentBuilder(await fodderBoard(cards,rating,year),{name:'fodder.png'})]});return;
 }

 if(i.commandName==='consumables'){
  const selectedPlatform=i.options.getString('market')??platform,category=i.options.getString('category')??'all';
  if(!['ps5','pc'].includes(selectedPlatform))throw new Error('Choose Console or PC.');
  const [raw,catalog]=await Promise.all([
   market.prices.miscItems(selectedPlatform),
   repo.pool.query('SELECT item_type,item_id::text,display_name FROM futbot_misc_item_catalog WHERE game_year=$1',[year])
  ]);
  const names=new Map(catalog.rows.map(row=>[`${row.item_type}:${row.item_id}`,row.display_name]));
  const items=raw.filter(item=>(category==='all'||item.item_type===category)&&item.price!==null&&Number(item.price)>0&&isFresh(item.last_checked_at??item.captured_at,market.maxAge)).map(item=>({...item,display_name:item.display_name||names.get(`${item.item_type}:${item.item_id}`)||null}));
  const rises=rankConsumables(items,'risers',5),falls=rankConsumables(items,'fallers',5);
  if(!items.length)throw new Error('No fresh consumable prices are available for that market/category yet.');
  const lines=(rows:typeof rises,empty:string)=>rows.length?rows.map((item,index)=>`**${index+1}. ${item.display_name||item.item_type.replaceAll('_',' ')}** · ${coins(Number(item.price))} · ${item.change_pct>0?'+':''}${item.change_pct.toFixed(1)}%`).join('\n'):`No qualifying moves. ${empty}`;
  const embed=brand(selectedPlatform).setTitle('🧴 CONSUMABLE MARKET WATCH').setDescription(`Top fresh price moves · ${selectedPlatform==='ps5'?'Console':'PC'} · FC${year}\n${category==='all'?'Managers, manager leagues and chemistry styles':category.replaceAll('_',' ')}`)
   .addFields({name:'📈 TOP RISERS',value:lines(rises,'No item has a valid 24-hour baseline.'),inline:true},{name:'📉 TOP DROPS',value:lines(falls,'No item has a valid 24-hour baseline.'),inline:true},{name:'HOW TO READ THIS',value:'Current observed lowest BIN vs the median price observed 24–25 hours ago. These are price movements, not sales-volume signals.'})
   .setImage('attachment://consumables.png');
  const choices=rankConsumables(items,'all',12);
  const components=choices.length?[new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId('miscfeeditem').setPlaceholder('Open an item · price, chart, watch or alert').addOptions(choices.map(item=>({label:(item.display_name||item.item_type.replaceAll('_',' ')).slice(0,100),description:`${coins(Number(item.price))} coins · ${item.change_pct>0?'+':''}${item.change_pct.toFixed(1)}% · ${item.item_type.replaceAll('_',' ')}`.slice(0,100),value:`${item.item_type}:${item.item_id}:${selectedPlatform}`}))))]:[];
  const guildBrand=i.guildId?await guildSettings(repo.pool,i.guildId):undefined;
  await i.editReply({embeds:[embed],files:[new AttachmentBuilder(await consumablesBoard(items,selectedPlatform,year,guildBrand),{name:'consumables.png'})],components});return;
 }
 if(i.commandName==='movers'||i.commandName==='budget'){
 let cards=await market.snapshot();let title='📈 MARKET RISERS';
 if(i.commandName==='movers'){const direction=i.options.getString('direction')??'risers';cards=movers(cards,direction);title=direction==='fallers'?'📉 MARKET FALLERS':title;}
 else{const budget=i.options.getInteger('coins',true),position=i.options.getString('position')?.toUpperCase(),rating=i.options.getInteger('rating')??75;cards=cards.filter(c=>c.value<=budget&&(c.rating??0)>=rating&&(!position||c.position===position)).sort((a,b)=>(b.rating??0)-(a.rating??0)||a.value-b.value).slice(0,10);title=`💎 UNDER ${coins(budget)} COINS`;}
 const embed=brand().setTitle(title).setDescription(cardLines(cards)).addFields({name:'READING THE MARKET',value:'80+ rated items from 1,000 coins. Fresh BIN vs the median of at least three observations 24–25 hours ago. Large swings need verifying in-game.'});if(cards[0]?.image?.startsWith('https://'))embed.setThumbnail(cards[0].image);await i.editReply({embeds:[embed]});return;
 }
 if(['watch','unwatch'].includes(i.commandName)){const c=await resolve(i.options.getString('player',true));if(i.commandName==='watch'){const p=await market.prices.latest(c.id,platform),start=p&&isFresh(p.capturedAt,market.maxAge)?p.value:null;await watch(repo.pool,i.user.id,c.id,year,platform,limits.watch,start);}else await repo.pool.query('DELETE FROM futbot_watchlist WHERE user_id=$1 AND card_id=$2 AND game_year=$3 AND platform=$4',[i.user.id,c.id,year,platform]);await i.editReply({embeds:[brand().setTitle(i.commandName==='watch'?'⭐ ADDED TO WATCHLIST':'REMOVED FROM WATCHLIST').setDescription(`${c.name} · Your watchlist is private.\nUse /watchlist to see your saved cards.`)]});return;}
 if(i.commandName==='watchlist'){const saved=await watchedMarkets(repo.pool,i.user.id,year),items=await Promise.all(saved.slice(0,10).map(async row=>{const [card,p,b]=await Promise.all([market.prices.card(row.id),market.prices.latest(row.id,row.platform),market.prices.baseline(row.id,row.platform)]);return card?{card,platform:row.platform,price:p,fresh:!!p&&isFresh(p.capturedAt,market.maxAge),baseline:b,startingPrice:row.startingPrice}:null;})),visible=items.filter((x):x is NonNullable<typeof x>=>!!x);const lines=visible.map((x,i)=>`**${String(i+1).padStart(2,'0')} · ${x.card.name.replace(/[*_`~|\\]/g,'')}** · ${x.card.rating??'—'} ${x.card.position??''} · ${x.platform.toUpperCase()}\n🪙 **${x.fresh?coins(Number(x.price!.value))+' coins':'No fresh price'}** · Watching from ${x.startingPrice?coins(Number(x.startingPrice))+' coins':'no saved start price'}${x.fresh&&x.baseline?.value?` · ${(Number(x.price!.value)-x.baseline.value)/x.baseline.value>=0?'📈 +':'📉 '}${(((Number(x.price!.value)-x.baseline.value)/x.baseline.value)*100).toFixed(1)}%`:''}`).join('\n\n');await i.editReply({embeds:[brand().setTitle('⭐ YOUR WATCHLIST').setDescription(saved.length?lines||'Your saved cards are waiting for fresh prices.':'Your watchlist is empty. ⭐ Use /watch player:… or press Watch on a price or flip post to save your first card.').addFields({name:'SAVED CARDS',value:`${saved.length}/${limits.watch} saved · First 10 shown across Console and PC. Full list in the dashboard.`})]});return;}
 if(i.commandName==='compare'){const cards=await Promise.all(['first','second'].map(n=>resolve(i.options.getString(n,true))));const embeds=[];for(const c of cards){const p=await market.prices.latest(c.id,platform);const e=brand().setTitle(`⚖️ ${c.name} · ${c.rating??'—'} ${c.position??''}`).setDescription(`${c.rarity??'Player item'} · ${c.club??'—'}`).addFields({name:'LOWEST BIN',value:p?coins(p.value)+' coins':'Unavailable',inline:true},{name:'PRICE STATUS',value:p?`${isFresh(p.capturedAt,market.maxAge)?'🟢 Fresh':'🟠 Stale'} · <t:${Math.floor(p.capturedAt.getTime()/1000)}:R>`:'No observation',inline:true},{name:'AFTER TAX',value:p?coins(Math.floor(p.value*.95))+' coins':'—',inline:true});if(c.image?.startsWith('https://'))e.setThumbnail(c.image);embeds.push(e);}await i.editReply({embeds});return;}
 if(['pausealert','resumealert'].includes(i.commandName)){const id=i.options.getString('id',true);if(!/^\d+$/.test(id))throw new Error('Enter a numeric alert ID.');const pause=i.commandName==='pausealert';const r=await repo.pool.query('UPDATE futbot_alerts SET state=$1 WHERE user_id=$2 AND id=$3 AND state=$4 RETURNING id',[pause?'paused':'active',i.user.id,id,pause?'active':'paused']);await i.editReply(r.rowCount?`✅ Alert #${id} ${pause?'paused':'resumed'}.`:'No matching alert in the required state belongs to you.');return;}
 if(i.commandName==='dashboard'){const url=process.env.PUBLIC_URL;if(!url){await i.editReply('Your dashboard URL has not been configured yet. Set PUBLIC_URL on the bot service.');return;}await i.editReply({embeds:[brand().setTitle('🎛 YOUR FUTBOT CONTROL ROOM').setDescription('Your watchlist, personal targets and live market tools. Server managers also get branding, publishing and activity controls.')],components:[new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setLabel('Open FutBot').setStyle(ButtonStyle.Link).setURL(new URL('/app/',url).href))]});return;}
 if(i.commandName==='help')await i.editReply({embeds:[brand().setTitle('📖 YOUR ULTIMATE TEAM TOOLKIT').setDescription('🪙 **Prices** · /price · /compare · /tax\n🧬 **FUT.GG** · /evolutions · /gallery\n🧱 **Fodder** · /fodder rating:85\n🧴 **Consumables** · /consumables · /consumable\n📈 **Market** · /movers · /budget\n⭐ **Watchlist** · /watch · /watchlist · /unwatch\n🔔 **Targets** · /alert · /myalerts · /editalert · /removealert\n⏯ **Controls** · /pausealert · /resumealert · /testdm\n📈 **Trader auto posts** · /tradepost set · /tradepost list · /tradepost cancel *(Trader role only)*\n⭐ **Server lists** · /serverwatchlist · /serverpro\n🎛 **Dashboard** · /dashboard\n\nPrices are observed market data, not guaranteed listings or profit.') ]});
}

