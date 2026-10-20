import {SlashCommandBuilder,AttachmentBuilder,ActionRowBuilder,StringSelectMenuBuilder,ButtonBuilder,ButtonStyle,EmbedBuilder,type ChatInputCommandInteraction} from 'discord.js';
import {MarketService,type MarketCard} from './market.js';
import {fodderRows,movers} from './market.js';
import {fodderBoard,consumablesBoard,rankConsumables} from './boards.js';
import {watch,watchedMarkets,guildSettings} from './settings.js';
import type {AlertRepository} from './alerts.js';
import type {Card} from './domain.js';
import {coins,isFresh} from './domain.js';
import {fetchFutggContext} from './futgg-context.js';
import {fetchPlayerPaths,pathUrl} from './evo-paths.js';
import {startGallery} from './gallery-view.js';
import {evoText,shortUnlock} from './evo-copy.js';
import {fetchSbcDetail,fetchSbcList,fetchSbcPlayers,fetchSbcSolutionNames} from './sbc.js';
const player=(o:any)=>o.setName('player').setDescription('Choose an exact card').setRequired(true).setAutocomplete(true);
export const extraCommands=[
 new SlashCommandBuilder().setName('fodder').setDescription('🧱 Cheapest fresh cards by rating, with a visual price ladder'),
 new SlashCommandBuilder().setName('evo').setDescription('🧬 Find an Evo or plan a player’s upgrades')
 .addSubcommand(s=>s.setName('info').setDescription('See Evo upgrades, requirements and popular players').addStringOption(o=>o.setName('evolution').setDescription('Choose an open Evo').setRequired(true).setAutocomplete(true)).addStringOption(o=>o.setName('market').setDescription('Card price market').addChoices({name:'Console',value:'ps5'},{name:'PC',value:'pc'})))
 .addSubcommand(s=>s.setName('player').setDescription('Find upgrade routes for a specific player card').addStringOption(player).addIntegerOption(o=>o.setName('max_evos').setDescription('Most Evos in one route (1–3)').setMinValue(1).setMaxValue(3)).addIntegerOption(o=>o.setName('budget').setDescription('Max Evo coin fees; buying the player costs extra').setMinValue(0).setMaxValue(15000000)).addStringOption(o=>o.setName('market').setDescription('Starting card price market').addChoices({name:'Console',value:'ps5'},{name:'PC',value:'pc'}))),
 new SlashCommandBuilder().setName('gallery').setDescription('🏆 Choose a Gallery and see the full shopping list').addStringOption(o=>o.setName('set').setDescription('Choose a Gallery').setRequired(true).setAutocomplete(true)).addStringOption(o=>o.setName('tier').setDescription('Target tier (default: highest available)').addChoices(...['S','A','B','C','D'].map(value=>({name:value+' tier',value})))),
 new SlashCommandBuilder().setName('sbc').setDescription('🧩 SBC requirements, rewards, expiry and cheapest solution').addStringOption(o=>o.setName('challenge').setDescription('Choose an active SBC').setRequired(true).setAutocomplete(true)).addStringOption(o=>o.setName('market').setDescription('Price market').addChoices({name:'Console',value:'ps5'},{name:'PC',value:'pc'})),
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
 if(i.commandName==='sbc'){
  const url=i.options.getString('challenge',true),selectedPlatform=i.options.getString('market')??platform;
  if(!['ps5','pc'].includes(selectedPlatform))throw new Error('Choose Console or PC.');
  const sbc=await fetchSbcDetail(url,fetch,selectedPlatform as 'ps5'|'pc'),embed=brand(selectedPlatform).setTitle('🧩 '+sbc.name.slice(0,220)).setURL(sbc.url).setDescription((sbc.description||'SBC details from FUT.GG.').slice(0,900));
  if(sbc.expires){const timestamp=Date.parse(sbc.expires);embed.addFields({name:'⏳ Expires',value:Number.isFinite(timestamp)?`<t:${Math.floor(timestamp/1000)}:R> · <t:${Math.floor(timestamp/1000)}:f>`:sbc.expires.slice(0,100),inline:true});}
  if(sbc.repeatable)embed.addFields({name:'🔁 Repeatable',value:`Refreshes every ${sbc.repeatable}`.slice(0,100),inline:true});
  const solverLinks:ButtonBuilder[]=[new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Open SBC on FUT.GG').setURL(sbc.url)];
  for(const [index,c] of sbc.challenges.slice(0,8).entries()){
   const lines=[c.description,c.requirements.length?'**You need**\n'+c.requirements.map(x=>'• '+x).join('\n'):null,c.reward?'**Reward**\n'+c.reward:null,c.price!==null?`**Cheapest ${selectedPlatform==='ps5'?'console':'PC'} solution · ${coins(c.price)} coins**`:null];
   if(c.routes.length){const best=c.routes[0];let players:Awaited<ReturnType<typeof fetchSbcPlayers>>=[];try{players=await fetchSbcPlayers(sbc.url,c,best,selectedPlatform as 'ps5'|'pc');}catch{/* Keep FUT.GG's cached solution summary visible when player details are unavailable. */}
    const full=players.length===best.cards;const total=full?players.reduce((sum,p)=>sum+p.price,0):best.price;
    lines[lines.length-1]=`**Cheapest solution · ${coins(total)} coins**${full?' · refreshed card prices':''}`;
    lines.push(`**${best.cards} cards · ${best.score.toLocaleString()} score**`);
    lines.push(full?players.map(p=>`• **${p.name}** · ${p.overall} ${p.rarity} · ${coins(p.price)}`).join('\n'):best.groups.map(g=>`${g.count}× ${g.overall} rated · ${coins(g.unitPrice)} each`).join('\n')+'\nPlayer names are not available from the feed right now.');
    const target=c.scoreRequirement??best.score;solverLinks.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(`Solve ${index+1} on FUT.GG`).setURL(`https://www.fut.gg/sbc/streamlined-solver/?target=${target}&platform=${selectedPlatform}`));
   }
   else if(c.solutionUrl){let names:string[]=[];try{names=await fetchSbcSolutionNames(c.solutionUrl,fetch,id=>market.prices.playerName(id));}catch{/* Keep the direct solution link available if its page is temporarily unavailable. */}lines.push(names.length?`**Best solution · ${names.length} cards**\n${names.map(name=>'• '+name).join('\n')}`:'**Best squad solution** · Open the linked FUT.GG squad for the full card list.');solverLinks.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(`Solution ${index+1}`).setURL(c.solutionUrl));}
   else if(c.streamlined)lines.push('FUT.GG has not published a solution for this challenge yet.');
   const value=lines.filter(Boolean).join('\n').slice(0,1000)||'Challenge details are not available.';
   embed.addFields({name:`${index+1}. ${c.name}`.slice(0,256),value});
  }
  if(sbc.challenges.length>8)embed.addFields({name:'More challenges',value:`Showing 8 of ${sbc.challenges.length}. Open FUT.GG for the rest.`});
  if(!sbc.challenges.length)embed.addFields({name:'Challenge data',value:'FUT.GG did not include challenge details on this page. Open the SBC page for the latest requirements and solution.'});
  embed.addFields({name:'Price note',value:'Cheapest solution prices are FUT.GG estimates for the selected market. Prices can change; check the in-game requirements before submitting.'});
  await i.editReply({embeds:[embed],components:[new ActionRowBuilder<ButtonBuilder>().addComponents(solverLinks.slice(0,5))]});return;
 }
 if(i.commandName==='evo'&&i.options.getSubcommand()==='player'){
  const card=await resolve(i.options.getString('player',true)),identity=await market.prices.evoIdentity(card.id);
  if(!identity)throw new Error('This card is missing its FUT.GG player identity. Choose another exact card.');
  const maxEvos=i.options.getInteger('max_evos')??3,budget=i.options.getInteger('budget'),selectedPlatform=i.options.getString('market')??platform;
  if(!['ps5','pc'].includes(selectedPlatform))throw new Error('Choose Console or PC.');
  const selectedMarket=selectedPlatform===platform?market:new MarketService(market.prices,selectedPlatform,market.maxAge);
  const source=pathUrl(identity.url),sourceUrl=source?new URL(source).origin+new URL(source).pathname.split('/').slice(0,3).join('/')+'/evolutions/':null;
  const sourceButton=sourceUrl?[new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('See player on FUT.GG').setURL(sourceUrl))]:[];
  let result;
  try{result=await fetchPlayerPaths(year,identity.playerId,card.id,maxEvos);}catch(error){await i.editReply({embeds:[brand(selectedPlatform).setTitle('🧬 Routes unavailable').setDescription(error instanceof Error?error.message:'Could not fetch Evolution paths.')],components:sourceButton});return;}
  const eligible=result.paths.filter(p=>budget===null||p.coins!==null&&p.coins<=budget),top=eligible.slice(0,3);
  const cheapest=eligible.filter(p=>p.coins!==null&&!p.unlocks.length).sort((a,b)=>a.coins!-b.coins!)[0];
  if(cheapest&&!top.some(p=>p.id===cheapest.id))top.push(cheapest);
  const base=(await selectedMarket.snapshot().catch(()=>[])).find(c=>c.id===card.id);
  const coverage=result.complete?`${eligible.length} available routes compared.`:`Search incomplete · ${result.fetched}${result.total!==null?' of '+result.total:''} results returned.`;
  const embed=brand(selectedPlatform).setTitle('🧬 '+evoText(card.name)+' · Evo routes').setDescription(`${card.rating??'—'} OVR · ${evoText(card.rarity??'Player item')} · ${card.position??'—'}\n**Starting card: ${base?coins(base.value)+' coins':'price unavailable'}**\n\n${coverage}${budget!==null?' · '+coins(budget)+' coin fee limit':''}`);
  if(!top.length){embed.addFields({name:'No routes found',value:'Try another card version, a higher budget or more Evos per route.'});}
  const buttons:ButtonBuilder[]=[];
  for(const [index,p]of top.entries()){
   const isBudget=index===3,stats=p.stats.filter(s=>s.after!==null&&s.after!==s.before).map(s=>`${s.label} ${s.before??'—'} → ${s.after}`).join(' · ');
   const costs=p.coins===null?'Fees unavailable':p.coins===0?'No coin fees':coins(p.coins)+' coin fees';
   const changes=p.upgrades.map(evoText).join(' · ').slice(0,220);
   const value=[p.names.map(evoText).join(' → ').slice(0,250),`**${p.startingOverall===p.overall?(p.overall??'—'):((p.startingOverall??'—')+' → '+(p.overall??'—'))} OVR · ${p.ggRating!==null?'GG score '+p.ggRating.toFixed(1):'GG score unavailable'}**`,stats,changes,`**${costs}**${p.points?' / '+coins(p.points)+' FC Points':''}`,p.unlocks.length?'🔒 '+p.unlocks.map(shortUnlock).join(' · ').slice(0,200):'',`Entry closes <t:${Math.floor(p.startBy/1000)}:R>`,p.training?'Training: '+evoText(p.training).slice(0,70):'',p.branches?'Follow the choices in the linked route.':''].filter(Boolean).join('\n');
   embed.addFields({name:isBudget?'💰 Lower coin fees':`${index+1}. ${index===0?(result.complete?'⭐ Top route':'⭐ Best returned route'):'Another route'}`,value:value.slice(0,1024)});
   buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(isBudget?'View lower-cost route':`View route ${index+1}`).setURL(p.url));
  }
  embed.addFields({name:'Before you start',value:'Sorted by GG score, then rating and coin fees. Buying the card costs extra. Check any pass or token unlocks above.'});
  if(card.image?.startsWith('https://'))embed.setThumbnail(card.image);
  await i.editReply({embeds:[embed],components:buttons.length?[new ActionRowBuilder<ButtonBuilder>().addComponents(buttons)]:sourceButton});return;
 }
 if(i.commandName==='evo'&&i.options.getSubcommand()==='info'){
  const selectedPlatform=i.options.getString('market')??platform,evoId=i.options.getString('evolution',true);
  if(!['ps5','pc'].includes(selectedPlatform))throw new Error('Choose Console or PC.');
  const context=await fetchFutggContext(year),evo=context.evolutions.find(row=>row.id===evoId);
  if(!evo)throw new Error('That Evolution is no longer open. Choose another from the command options.');
  const selectedMarket=selectedPlatform===market.platform?market:new MarketService(market.prices,selectedPlatform,market.maxAge);
  const prices=new Map((await selectedMarket.snapshot()).map(card=>[card.id,card]));
  const popular=evo.popularPicks??[],seen=new Set<string>();
  const picks=(popular.length?popular:evo.eligibleCardIds.map(id=>({id,path:'',chained:false}))).filter(pick=>{if(seen.has(pick.id))return false;seen.add(pick.id);return true;}).slice(0,20);
  const resolved=await Promise.all(picks.map(async pick=>({pick,card:prices.get(pick.id)??await market.prices.card(pick.id)})));
  const visible=resolved.filter((row):row is typeof row&{card:Card}=>!!row.card&&!!row.card.name?.trim()&&!/^unknown(?: card| player)?$/i.test(row.card.name.trim())).slice(0,5);
  const lines=visible.map(({pick,card},idx)=>{
   const fresh=prices.get(pick.id),cost=pick.chained?'Previous Evo needed':fresh?`${coins(fresh.value)} coins`:'Price unavailable';
   return `**${idx+1}. ${evoText(card.name).slice(0,55)}** · ${card.rating??'—'} ${card.position??''}\n${evoText(card.rarity??'Player item').slice(0,45)} · **${cost}**`;
  });
  const startBy=evo.startsBy??evo.closesAt,cost=evo.unlock?shortUnlock(evo.unlock):(evo.coinsCost?`${coins(evo.coinsCost)} coins${evo.pointsCost?' / '+coins(evo.pointsCost)+' FC Points':''}`:evo.pointsCost?`${evo.pointsCost} FC Points`:'Free entry');
  const start=Math.floor(Date.parse(startBy)/1000),end=Math.floor(Date.parse(evo.closesAt)/1000);
  const deadline=start===end?`Closes <t:${start}:R>`:`Entry closes <t:${start}:R> · Finish deadline <t:${end}:R>`;
  const embed=brand(selectedPlatform).setTitle('🧬 '+evoText(evo.name)).setDescription(`**${cost}**\n${deadline}`);
  const bullets=(values:string[],max=700)=>{let text='';for(const value of values){const line='• '+evoText(value);if(text.length+line.length+1>max)return (text||line.slice(0,max-30))+'\nFull details on FUT.GG.';text+=(text?'\n':'')+line;}return text;};
  embed.addFields({name:'⚡ Upgrades',value:evo.upgrades?.length?bullets(evo.upgrades):evoText(evo.description??'See the upgrades on FUT.GG.').slice(0,700)});
  embed.addFields({name:'✅ Your card needs',value:evo.requirements?.length?bullets(evo.requirements):'Check entry rules on FUT.GG.'});
  if(evo.completion?.length)embed.addFields({name:'🎮 Tasks',value:bullets(evo.completion)});
  embed.addFields({name:popular.length?'⭐ Popular picks':'👥 Example players',value:lines.join('\n\n')||'Player details are unavailable. See the player list on FUT.GG.'});
  embed.addFields({name:'Before you start',value:(popular.length?'Picks follow FUT.GG popularity. ':'Only a sample is available. ')+'Prices are for the starting card. '+(!evo.completion?.length?'Open FUT.GG for completion tasks.':'Open a player’s route with /evo player.')});
  if(visible[0]?.card.image?.startsWith('https://'))embed.setThumbnail(visible[0].card.image);
  const components=evo.url?[new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Full Evo details').setURL(evo.url))]:[];
  await i.editReply({embeds:[embed],components});return;
 }
 if(i.commandName==='gallery'){
  const setId=i.options.getString('set',true),context=await fetchFutggContext(year),tiers=context.gallery.filter(row=>row.setId===setId&&row.coinsPerToken!==null);
  await i.editReply(await startGallery(i.user.id,tiers,()=>brand(),id=>market.prices.galleryCard(id),i.options.getString('tier')));return;
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
 if(i.commandName==='help')await i.editReply({embeds:[brand().setTitle('📖 YOUR ULTIMATE TEAM TOOLKIT').setDescription('🪙 **Prices** · /price · /compare · /tax\n🧬 **Evolutions** · /evo info · /evo player\n🧩 **SBCs** · /sbc challenge:…\n🏆 **Gallery** · /gallery set:…\n🧱 **Fodder** · /fodder rating:85\n🧴 **Consumables** · /consumables · /consumable\n📈 **Market** · /movers · /budget\n⭐ **Watchlist** · /watch · /watchlist · /unwatch\n🔔 **Targets** · /alert · /myalerts · /editalert · /removealert\n⏯ **Controls** · /pausealert · /resumealert · /testdm\n📈 **Trader auto posts** · /tradepost set · /tradepost list · /tradepost cancel *(Trader role only)*\n⭐ **Server lists** · /serverwatchlist · /serverpro\n🎛 **Dashboard** · /dashboard\n\nPrices are observed market data, not guaranteed listings or profit.') ]});
}

