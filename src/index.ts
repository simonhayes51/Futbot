import {benefits,membership,feedPermission,hasTraderRole,tradePostAccess} from './community.js';
import {claimSeat,requireServerPlan,serverPlan} from './plans.js';
import {feedTick,sharedCards} from './feeds.js';
import {alertPrices,alertPriceText} from './alert-view.js';
import 'dotenv/config';
import {logFailure} from './logging.js';
import {AsyncLocalStorage} from 'node:async_hooks';
import {MarketService} from './market.js';
import {startWeb} from './web.js';
import type {Server} from 'node:http';
import {extraCommands,handleTool} from './tools.js';
import {fetchFutggContext} from './futgg-context.js';
import {guildSettings,defaultBrand,watch,type GuildSettings} from './settings.js';
import { Client, MessageFlags, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, ChannelType, type Interaction } from 'discord.js';
import { PriceRepository,isMiscItemType,type MiscItemType } from './prices.js';
import { MiscCatalog } from './misc-catalog.js';
import { AlertRepository,alertTick,fodderAlertTick,miscAlertTick,type Alert } from './alerts.js';
import { coins,isFresh,tradeProfit,type Direction,type Card } from './domain.js';
import { marketChart } from './chart.js';
import {tradeReceipt} from './boards.js';
import {createTradePost,cancelTradePost,listTradePosts,tradeBuyPrice,tradePostTick,type TradePost} from './trade-posts.js';

for(const key of ['PRICE_DATABASE_URL','APP_DATABASE_URL','DISCORD_TOKEN'])if(!process.env[key])throw new Error(`Missing ${key}. See .env.example.`);
if(process.env.PRICE_DATABASE_URL===process.env.APP_DATABASE_URL)throw new Error('Use a separate application database');
const year=Number(process.env.GAME_YEAR||27),platform=process.env.PLATFORM||'ps5';
const maxAge=Number(process.env.MAX_PRICE_AGE_MINUTES||15),limit=Number(process.env.FREE_ALERT_LIMIT||3);
const pollMs=Math.max(15000,Number(process.env.ALERT_POLL_MS||30000));
if(![year,maxAge,limit,pollMs].every(Number.isFinite))throw new Error('Invalid numeric configuration');
const prices=new PriceRepository(process.env.PRICE_DATABASE_URL!,year);
const alerts=new AlertRepository(process.env.APP_DATABASE_URL!);
const miscCatalog=new MiscCatalog(alerts.pool,year);
const client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMembers]});
const context=new AsyncLocalStorage<GuildSettings>();
const market=new MarketService(prices,platform,maxAge);
const brand=(pricePlatform=platform)=>{const b=context.getStore()??defaultBrand;return new EmbedBuilder().setColor(b.accent as `#${string}`).setAuthor({name:b.name}).setFooter({text:`${b.footer} • FC${year} • ${pricePlatform.toUpperCase()}`});};
const playerOption=(o:any)=>o.setName('player').setDescription('Search a player and choose the exact card').setRequired(true).setAutocomplete(true);
const commands=[...extraCommands,
  new SlashCommandBuilder().setName('price').setDescription('Check a card price with artwork and market history').addStringOption(playerOption).addStringOption(o=>o.setName('platform').setDescription('Market for this price lookup').addChoices({name:'PS5 / Xbox · Console',value:'ps5'},{name:'PC',value:'pc'})),
  new SlashCommandBuilder().setName('consumable').setDescription('Check a manager or consumable price and chart')
    .addStringOption(o=>o.setName('type').setDescription('Consumable category').setRequired(true).addChoices({name:'Manager',value:'manager'},{name:'Manager league',value:'manager_league'},{name:'Chemistry style',value:'chemistry_style'}))
    .addStringOption(o=>o.setName('item').setDescription('Search by manager or consumable name').setRequired(true).setAutocomplete(true))
    .addStringOption(o=>o.setName('platform').setDescription('Market for this lookup').addChoices({name:'PS5 / Xbox · Console',value:'ps5'},{name:'PC',value:'pc'})),
  new SlashCommandBuilder().setName('flip').setDescription('Post a player flip with live market context and member actions')
    .addStringOption(playerOption)
    .addStringOption(o=>o.setName('platform').setDescription('Market for this flip').setRequired(true).addChoices({name:'PS5 / Xbox · Console',value:'ps5'},{name:'PC',value:'pc'}))
    .addStringOption(o=>o.setName('risk').setDescription('Your own risk rating').addChoices({name:'Low risk',value:'low'},{name:'Medium risk',value:'medium'},{name:'High risk',value:'high'}))
    .addIntegerOption(o=>o.setName('entry').setDescription('Your suggested buy price or max entry').setMinValue(1).setMaxValue(15000000))
    .addIntegerOption(o=>o.setName('target').setDescription('Your suggested sell target').setMinValue(1).setMaxValue(15000000))
    .addStringOption(o=>o.setName('note').setDescription('Why you like the flip (optional)').setMaxLength(240)),
  new SlashCommandBuilder().setName('tradepost').setDescription('Set a trader-only automatic buy post')
    .addSubcommand(s=>s.setName('set').setDescription('Post a trade automatically when your buy trigger is met')
      .addStringOption(o=>o.setName('player').setDescription('Choose an exact player card').setRequired(true).setAutocomplete(true))
      .addStringOption(o=>o.setName('platform').setDescription('Market for this trade').setRequired(true).addChoices({name:'PS5 / Xbox · Console',value:'ps5'},{name:'PC',value:'pc'}))
      .addStringOption(o=>o.setName('trigger').setDescription('When should the post go out?').setRequired(true).addChoices({name:'BIN reaches a coin price',value:'price'},{name:'Drop by a percentage from current BIN',value:'drop_pct'}))
      .addIntegerOption(o=>o.setName('amount').setDescription('Coin price, or whole percentage drop (1–50)').setRequired(true).setMinValue(1).setMaxValue(15000000))
      .addChannelOption(o=>o.setName('channel').setDescription('Choose where FutBot should post').addChannelTypes(ChannelType.GuildText,ChannelType.GuildAnnouncement).setRequired(true))
      .addIntegerOption(o=>o.setName('sell').setDescription('Optional sell target in coins').setMinValue(1).setMaxValue(15000000))
      .addStringOption(o=>o.setName('note').setDescription('Optional trade note').setMaxLength(240)))
    .addSubcommand(s=>s.setName('list').setDescription('View your active and recent auto posts'))
    .addSubcommand(s=>s.setName('cancel').setDescription('Cancel one of your active auto posts').addStringOption(o=>o.setName('id').setDescription('Trade post ID from /tradepost list').setRequired(true))),
  new SlashCommandBuilder().setName('alert').setDescription('Get a private DM when a card reaches your price').addStringOption(playerOption)
    .addStringOption(o=>o.setName('direction').setDescription('Target direction').setRequired(true).addChoices({name:'At or below',value:'below'},{name:'At or above',value:'above'}))
    .addIntegerOption(o=>o.setName('target').setDescription('Target price in coins').setRequired(true).setMinValue(1).setMaxValue(15000000)),
  new SlashCommandBuilder().setName('testdm').setDescription('Check that FutBot can send you a private notification'),
  new SlashCommandBuilder().setName('editalert').setDescription('Change an active or paused price target').addStringOption(o=>o.setName('id').setDescription('Alert ID from /myalerts').setRequired(true)).addIntegerOption(o=>o.setName('target').setDescription('New target in coins').setRequired(true).setMinValue(1).setMaxValue(15000000)).addStringOption(o=>o.setName('direction').setDescription('Optional trigger direction').addChoices({name:'At or below',value:'below'},{name:'At or above',value:'above'})),
  new SlashCommandBuilder().setName('serverpro').setDescription('Claim an included Pro seat from this server'),
  new SlashCommandBuilder().setName('serverwatchlist').setDescription('Browse this server’s shared player lists').addStringOption(o=>o.setName('list').setDescription('List ID to open')),
  new SlashCommandBuilder().setName('myalerts').setDescription('View your personal price alerts'),
  new SlashCommandBuilder().setName('removealert').setDescription('Cancel one of your saved alerts').addStringOption(o=>o.setName('id').setDescription('Alert ID from /myalerts').setRequired(true)),
  new SlashCommandBuilder().setName('tax').setDescription('Calculate profit after EA tax').addIntegerOption(o=>o.setName('buy').setDescription('Buy price').setRequired(true).setMinValue(1).setMaxValue(15000000))
    .addIntegerOption(o=>o.setName('sell').setDescription('Sell price').setRequired(true).setMinValue(1).setMaxValue(15000000))
    .addIntegerOption(o=>o.setName('quantity').setDescription('Number of copies').setMinValue(1).setMaxValue(1000))
];
async function resolveCard(value:string):Promise<Card>{
  if(/^\d+$/.test(value)){const c=await prices.card(value);if(c)return c;}
  const matches=await prices.search(value);
  if(matches.length===1)return matches[0];
  throw new Error(matches.length?'Several cards match. Type the name and choose an exact version from autocomplete.':'No matching FC card found.');
}
async function showPrice(card:Card,hours=24,pricePlatform=platform){
  const [price,history]=await Promise.all([prices.latest(card.id,pricePlatform),prices.history(card.id,pricePlatform,hours)]);
  const embed=brand(pricePlatform).setTitle(`🪙 ${card.name} · ${card.rating??'—'} ${card.position??''}`).setDescription(`${card.rarity||'Player item'}${card.club?' · '+card.club:''}`);
  if(card.image&&card.image.startsWith('https://'))embed.setThumbnail(card.image);
  const files:AttachmentBuilder[]=[];
  if(!price){embed.addFields({name:'Market price',value:'No price available for this market.'});return {embeds:[embed],files,components:[]};}
  const fresh=isFresh(price.capturedAt,maxAge),age=Math.floor(price.capturedAt.getTime()/1000);
  const period=hours===168?'7-day':'24-hour';
  embed.addFields({name:'LOWEST BIN',value:`**${coins(price.value)} coins**`,inline:true},{name:'PRICE UPDATED',value:`<t:${age}:R>${fresh?'':' · ⚠ STALE'}`,inline:true});
  if(history.length>1){const first=history[0].value,change=(price.value-first)/first*100;
    embed.addFields({name:`${period.toUpperCase()} CHANGE`,value:`${change>=0?'+':''}${change.toFixed(1)}%`,inline:true});
    const png=await marketChart(`${card.name} / ${period} history`,history);if(png){files.push(new AttachmentBuilder(png,{name:'market.png'}));embed.setImage('attachment://market.png');}
  }
  if(history.length){const values=history.map(p=>p.value);embed.addFields({name:`${period.toUpperCase()} LOW`,value:coins(Math.min(...values))+' coins',inline:true},{name:`${period.toUpperCase()} HIGH`,value:coins(Math.max(...values))+' coins',inline:true},{name:'AFTER 5% TAX',value:coins(Math.floor(price.value*.95))+' coins',inline:true});}
  embed.setFooter({text:`${context.getStore()?.footer??defaultBrand.footer} • FC${year} • ${pricePlatform.toUpperCase()} • Observed BIN`}).setTimestamp(price.capturedAt);
  const row=new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`newalert:${card.id}:${pricePlatform}`).setLabel('Buy alert').setEmoji('🔔').setStyle(ButtonStyle.Primary),new ButtonBuilder().setCustomId(`history:${card.id}:${hours===24?168:24}:${pricePlatform}`).setLabel(hours===24?'7-day chart':'24-hour chart').setEmoji('📊').setStyle(ButtonStyle.Secondary),new ButtonBuilder().setCustomId(`abovealert:${card.id}:${pricePlatform}`).setLabel('Sell alert').setEmoji('📈').setStyle(ButtonStyle.Secondary),new ButtonBuilder().setCustomId(`watch:${card.id}:${pricePlatform}`).setLabel('Watch').setEmoji('⭐').setStyle(ButtonStyle.Secondary),new ButtonBuilder().setCustomId(`history:${card.id}:${hours}:${pricePlatform}`).setLabel('Refresh').setEmoji('🔄').setStyle(ButtonStyle.Secondary));
  return {embeds:[embed],files,components:[row]};
}
async function showMiscPrice(itemType:MiscItemType,itemId:string,range=24,pricePlatform=platform){
  await miscCatalog.ready();
  const [item,history]=await Promise.all([prices.miscLatest(itemType,itemId,pricePlatform),prices.miscHistory(itemType,itemId,pricePlatform,range)]);
  const label=item?.display_name||miscCatalog.label(itemType,itemId),embed=brand(pricePlatform).setTitle(`🧴 ${label}`).setDescription(`FC${year} ${itemType.replaceAll('_',' ')}`);
  if(!item){embed.addFields({name:'Market status',value:'No price observation has been captured for this item yet.'});return {embeds:[embed],files:[],components:[]};}
  const checkedAt=item.last_checked_at??item.captured_at,fresh=item.price!==null&&item.price>0&&isFresh(checkedAt,Math.max(30,maxAge)),period=range===168?'7-day':'24-hour',files:AttachmentBuilder[]=[];
  if(item.price===null||item.price<=0){embed.addFields({name:'CURRENT MARKET',value:`No active listing · ${String(item.status).replaceAll('_',' ')}`,inline:true});}
  else{
    embed.addFields({name:'CURRENT PRICE',value:`**${coins(item.price)} coins**`,inline:true},{name:'LAST CHECKED',value:`<t:${Math.floor(new Date(checkedAt).getTime()/1000)}:R>${fresh?'':' · ⚠ STALE'}`,inline:true});
    if(history.length>1){const change=(item.price-history[0].value)/history[0].value*100;embed.addFields({name:`${period.toUpperCase()} CHANGE`,value:`${change>=0?'+':''}${change.toFixed(1)}%`,inline:true});}
    if(history.length){const values=history.map(p=>p.value);embed.addFields({name:`${period.toUpperCase()} LOW`,value:coins(Math.min(...values))+' coins',inline:true},{name:`${period.toUpperCase()} HIGH`,value:coins(Math.max(...values))+' coins',inline:true},{name:'AFTER 5% TAX',value:coins(Math.floor(item.price*.95))+' coins',inline:true});}
  }
  embed.setFooter({text:`${context.getStore()?.footer??defaultBrand.footer} • FC${year} • ${pricePlatform.toUpperCase()} • Observed price`}).setTimestamp(checkedAt);
  if(history.length>1){const png=await marketChart(`${label} / ${period} history`,history);if(png){files.push(new AttachmentBuilder(png,{name:'consumable-market.png'}));embed.setImage('attachment://consumable-market.png');}}
  const row=new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`miscalert:${itemType}:${itemId}:below:${pricePlatform}`).setLabel('Alert below').setEmoji('🔔').setStyle(ButtonStyle.Primary).setDisabled(!fresh||item.price===null),
    new ButtonBuilder().setCustomId(`miscalert:${itemType}:${itemId}:above:${pricePlatform}`).setLabel('Alert above').setEmoji('📈').setStyle(ButtonStyle.Secondary).setDisabled(!fresh||item.price===null),
    new ButtonBuilder().setCustomId(`mischistory:${itemType}:${itemId}:${range===24?168:24}:${pricePlatform}`).setLabel(range===24?'7-day chart':'24-hour chart').setEmoji('📊').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`miscwatch:${itemType}:${itemId}:${pricePlatform}`).setLabel('Watch').setEmoji('⭐').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`mischistory:${itemType}:${itemId}:${range}:${pricePlatform}`).setLabel('Refresh').setEmoji('🔄').setStyle(ButtonStyle.Secondary)
  );
  return {embeds:[embed],files,components:[row]};
}
async function saveMiscWatch(userId:string,itemType:MiscItemType,itemId:string,pricePlatform:string){
  const access=await benefits(alerts.pool,userId),c=await alerts.pool.connect();
  try{
    await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[userId]);
    const exists=await c.query(`SELECT 1 FROM futbot_misc_watchlist WHERE user_id=$1 AND game_year=$2 AND platform=$3 AND item_type=$4 AND item_id=$5`,[userId,year,pricePlatform,itemType,itemId]);
    if(!exists.rowCount){
      const count=await c.query(`SELECT ((SELECT count(*) FROM futbot_watchlist WHERE user_id=$1)+(SELECT count(*) FROM futbot_misc_watchlist WHERE user_id=$1))::int AS n`,[userId]);
      if(Number(count.rows[0].n)>=access.watch)throw new Error(`Your saved watchlist limit is ${access.watch}.`);
      const latest=await prices.miscLatest(itemType,itemId,pricePlatform),start=latest&&latest.price!==null&&latest.price>0&&isFresh(latest.last_checked_at??latest.captured_at,Math.max(30,maxAge))?latest.price:null;
      await c.query(`INSERT INTO futbot_misc_watchlist(user_id,game_year,platform,item_type,item_id,starting_price) VALUES($1,$2,$3,$4,$5,$6)`,[userId,year,pricePlatform,itemType,itemId,start]);
    }
    await c.query('COMMIT');
  }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
}
async function createAlert(i:any,value:string,direction:Direction,target:number,pricePlatform=platform){
  if(!Number.isInteger(target)||target<1||target>15000000)throw new Error('Enter a whole coin amount between 1 and 15,000,000.');
  const card=await resolveCard(value);
  const a=await alerts.create({userId:i.user.id,guildId:i.guildId,cardId:card.id,cardName:card.name,year,platform:pricePlatform,direction,target},(await benefits(alerts.pool,i.user.id)).alerts);
  const embed=brand(pricePlatform).setTitle('PRICE ALERT / WATCHING').setDescription(`**${card.name}** · ${pricePlatform.toUpperCase()}\nNotify at or ${direction} **${coins(target)} coins**.`).addFields({name:'Alert ID',value:String(a.id),inline:true},{name:'Manage',value:'Use /myalerts or /removealert. Enable DMs to receive notifications.'});
  const p=await prices.latest(card.id,pricePlatform).catch(()=>null);embed.addFields({name:'CURRENT BIN',value:alertPriceText({currentPrice:p?.value??null,priceCapturedAt:p?.capturedAt??null,priceFresh:!!p&&isFresh(p.capturedAt,maxAge)}),inline:true},{name:'CARD VERSION',value:`${card.rating??'—'} ${card.position??''} · ${card.rarity??'Player item'}`,inline:true});
  if(card.image?.startsWith('https://'))embed.setThumbnail(card.image);
  return embed;
}
async function createFlipPost(i:any,card:Card,pricePlatform:string){
  if(!i.guildId)throw new Error('Post flip ideas inside a Discord server.');
  if(!['ps5','pc'].includes(pricePlatform))throw new Error('Choose Console or PC.');
  const entry=i.options.getInteger('entry'),target=i.options.getInteger('target');
  if(entry===null&&target===null)throw new Error('Add an entry price or a sell target so members know what the call is.');
  const live=await prices.latest(card.id,pricePlatform);
  if(!live||!isFresh(live.capturedAt,maxAge))throw new Error(`There isn’t a fresh ${pricePlatform.toUpperCase()} price for ${card.name} yet, so I can’t post it as a live market call.`);
  const result=await showPrice(card,24,pricePlatform);
  const embed=result.embeds[0] as EmbedBuilder;
  const member=i.member as any;
  const posterName=member?.nick||i.user.globalName||i.user.username;
  embed.setAuthor({name:`${posterName} posted a flip`,iconURL:i.user.displayAvatarURL()});
  embed.setTitle(`📊 FLIP IDEA · ${card.name}`);
  embed.setDescription(`${(i.options.getString('risk')||'unrated').toUpperCase()} RISK · TRADER RATED · ${pricePlatform.toUpperCase()}\n${i.options.getString('note')||'No extra notes.'}`);
  embed.addFields(
    {name:'🟢 SUGGESTED ENTRY',value:entry===null?'Not set':`${coins(entry)} coins`,inline:true},
    {name:'🎯 SUGGESTED TARGET',value:target===null?'Not set':`${coins(target)} coins`,inline:true},
  );
  if(entry!==null&&target!==null){
    const profit=tradeProfit(entry,target);
    embed.addFields({name:'EST. PROFIT AFTER TAX',value:`${profit.profit>=0?'+':''}${coins(profit.profit)} / card`,inline:true});
  }
  return {...result,allowedMentions:{parse:[]}};
}
async function showAlerts(user:string,page=0){
 const rows=await alertPrices(await alerts.list(user),prices,maxAge),pages=Math.max(1,Math.ceil(rows.length/3));page=Math.max(0,Math.min(page,pages-1));
 if(!rows.length)return {embeds:[brand().setTitle('🔔 YOUR PRICE TARGETS').setDescription('No saved alerts. Use /alert or press Buy alert on /price.')],components:[]};
 const embeds=rows.slice(page*3,page*3+3).map(a=>{const c=a.card;const e=brand().setTitle(`🔔 #${a.id} · ${a.card_name}`).setDescription(`${c?.rating??'—'} ${c?.position??''} · ${c?.rarity??'Player item'} · ${a.platform.toUpperCase()} · **${a.state.toUpperCase()}**`).addFields({name:'🎯 SAVED TARGET',value:`${a.direction==='below'?'At or below':'At or above'} **${coins(Number(a.target))} coins**`,inline:true},{name:'🪙 CURRENT BIN',value:alertPriceText(a),inline:true},{name:'DISTANCE TO TARGET',value:a.gap===null?'Waiting for fresh prices':a.gap===0?'Target met — delivery depends on alert state':`${coins(a.gap)} coins to ${a.direction==='below'?'drop':'rise'}`,inline:true});if(c?.image?.startsWith('https://'))e.setThumbnail(c.image);return e;});
 const components=rows.slice(page*3,page*3+3).map(a=>new ActionRowBuilder<ButtonBuilder>().addComponents(...(['active','paused'].includes(a.state)?[new ButtonBuilder().setCustomId(`editalert:${a.id}`).setLabel(`Edit #${a.id}`).setStyle(ButtonStyle.Primary),new ButtonBuilder().setCustomId(`alertstate:${a.id}:${a.state==='active'?'paused':'active'}`).setLabel(a.state==='active'?'Pause':'Resume').setStyle(ButtonStyle.Secondary)]:[]),new ButtonBuilder().setCustomId(`removealert:${a.id}`).setLabel(`Cancel #${a.id}`).setDisabled(a.state==='queued').setStyle(ButtonStyle.Danger)));
 if(pages>1)components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`alertpage:${page-1}`).setLabel('Previous').setDisabled(page===0).setStyle(ButtonStyle.Secondary),new ButtonBuilder().setCustomId(`alertpage:${page+1}`).setLabel(`Next · ${page+1}/${pages}`).setDisabled(page===pages-1).setStyle(ButtonStyle.Secondary)));
 return {embeds,components};
}

async function sendTradePost(post:TradePost,observed:{value:number;capturedAt:Date}):Promise<string|null>{
 const access=await tradePostAccess(post.guild_id,post.user_id,post.channel_id);
 if(!access.trader)return null;
 if(!access.channel)throw new Error('FutBot or the trader can no longer post in the chosen channel.');
 const channel=await client.channels.fetch(post.channel_id);
 if(!channel||(channel.type!==ChannelType.GuildText&&channel.type!==ChannelType.GuildAnnouncement))throw new Error('The chosen trade channel is no longer available.');
 const [card,history]=await Promise.all([prices.card(post.card_id),prices.history(post.card_id,post.platform,24).catch(()=>[])]);
 const graph=await marketChart(`${post.card_name} · ${post.platform.toUpperCase()} 24-hour BIN`,history).catch(()=>null);
 const settings=await guildSettings(alerts.pool,post.guild_id);
 return context.run(settings,async()=>{
  const version=`${card?.rating??'—'} ${card?.position??''} · ${card?.rarity??'Player card'}`;
  const embed=brand(post.platform).setTitle('🔔 AUTO TRADE POST').setDescription(`**${post.card_name}**\n${version}`)
   .addFields({name:'BUY PRICE',value:`At or below **${coins(post.buy_price)} coins**`,inline:true},{name:'PRICE AT TRIGGER',value:`**${coins(observed.value)} coins**`,inline:true},{name:'PLATFORM',value:post.platform.toUpperCase(),inline:true});
  if(post.sell_price)embed.addFields({name:'SELL TARGET',value:`${coins(post.sell_price)} coins`,inline:true});
  if(post.trigger_type==='drop_pct')embed.addFields({name:'TRIGGER',value:`${Number(post.trigger_value)}% below setup BIN (${coins(post.baseline_price)})`,inline:true});
  if(post.note)embed.addFields({name:'NOTE',value:post.note,inline:false});
  embed.addFields({name:'SET BY',value:`<@${post.user_id}>`,inline:true}).setTimestamp(observed.capturedAt);
  if(card?.image?.startsWith('https://'))embed.setThumbnail(card.image);
  const files=graph?[new AttachmentBuilder(graph,{name:'trade-price-24h.png'})]:[];
  if(graph)embed.setImage('attachment://trade-price-24h.png');
  const message=await channel.send({embeds:[embed],files,allowedMentions:{parse:[]},nonce:`fbtp${post.id}`,enforceNonce:true});
  return message.id;
 });
}
async function handle(i:Interaction){
  if(i.isAutocomplete()){
    const q=i.options.getFocused();
    if(i.commandName==='consumable'){
      const type=i.options.getString('type')??'',pricePlatform=i.options.getString('platform')??platform;
      if(!isMiscItemType(type)){await i.respond([]);return;}
      await miscCatalog.ready();
      const items=await prices.miscItems(pricePlatform);
      const query=String(q).trim().toLocaleLowerCase();
      const choices=items.filter(item=>item.item_type===type&&(!query||item.item_id.includes(query)||(item.display_name||miscCatalog.label(type,item.item_id)).toLocaleLowerCase().includes(query))).slice(0,25).map(item=>({name:(item.display_name||miscCatalog.label(type,item.item_id)).slice(0,100),value:item.item_id}));
      await i.respond(choices);return;
    }
    const query=String(q).trim().toLocaleLowerCase();
    if(i.commandName==='evolutions'){
      const rows=(await fetchFutggContext(market.prices.year)).evolutions.filter(row=>!query||row.name.toLocaleLowerCase().includes(query)).slice(0,25);
      await i.respond(rows.map(row=>({name:`${row.name} · ${row.playerCount??row.eligibleCardIds.length} FUT.GG results`.slice(0,100),value:row.id})));return;
    }
    if(i.commandName==='gallery'){
      const rows=(await fetchFutggContext(market.prices.year)).gallery.filter(row=>row.coinsPerToken!==null);
      const sets=new Map<string,{name:string;best:number;tiers:number}>();
      for(const row of rows){const current=sets.get(row.setId);if(!current)sets.set(row.setId,{name:row.name,best:row.coinsPerToken!,tiers:1});else{current.best=Math.min(current.best,row.coinsPerToken!);current.tiers++;}}
      const choices=[...sets.entries()].filter(([,set])=>!query||set.name.toLocaleLowerCase().includes(query)).sort((a,b)=>a[1].best-b[1].best).slice(0,25).map(([id,set])=>({name:`${set.name} · best ${set.best.toLocaleString()} coins/token`.slice(0,100),value:id}));
      await i.respond(choices);return;
    }
    if(q.length<2){await i.respond([]);return;}
    const cards=await prices.search(q);await i.respond(cards.map(c=>({name:`${c.name} · ${c.rating??'?'} ${c.position??''} · ${c.rarity??''}`.slice(0,100),value:c.id})));return;
  }
  if(i.isStringSelectMenu()&&i.customId==='feedcard'){await i.deferReply({flags:MessageFlags.Ephemeral});await i.editReply(await showPrice(await resolveCard(i.values[0])));return;}
  if(i.isStringSelectMenu()&&i.customId==='miscfeeditem'){await i.deferReply({flags:MessageFlags.Ephemeral});const [type,id,pricePlatform]=i.values[0].split(':');if(isMiscItemType(type))await i.editReply(await showMiscPrice(type,id,24,pricePlatform));else await i.editReply('That consumable selection is invalid.');return;}
  if(i.isButton()){
    if(i.customId.startsWith('miscalert:')){const [,type,id,direction,pricePlatform]=i.customId.split(':');if(!isMiscItemType(type))return;const modal=new ModalBuilder().setCustomId(`miscmodal:${type}:${id}:${direction}:${pricePlatform}`).setTitle('Set consumable price target');modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('target').setLabel(direction==='below'?'Notify at or below (coins)':'Notify at or above (coins)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(8)));await i.showModal(modal);return;}
    if(i.customId.startsWith('mischistory:')){const [,type,id,range,pricePlatform]=i.customId.split(':');if(!isMiscItemType(type))return;await i.deferReply({flags:MessageFlags.Ephemeral});await i.editReply(await showMiscPrice(type,id,Number(range)===168?168:24,pricePlatform));return;}
    if(i.customId.startsWith('miscwatch:')){const [,type,id,pricePlatform]=i.customId.split(':');if(!isMiscItemType(type))return;await i.deferReply({flags:MessageFlags.Ephemeral});const item=await prices.miscLatest(type,id,pricePlatform);await saveMiscWatch(i.user.id,type,id,pricePlatform);await i.editReply(`⭐ ${item?.display_name||miscCatalog.label(type,id)} saved to your ${pricePlatform.toUpperCase()} consumables watchlist. Open /dashboard to track it.`);return;}
    if(i.customId.startsWith('alertpage:')){await i.deferReply({flags:MessageFlags.Ephemeral});await i.editReply(await showAlerts(i.user.id,Number(i.customId.split(':')[1])));return;}
    if(i.customId.startsWith('editalert:')){const id=i.customId.split(':')[1],a=(await alerts.list(i.user.id)).find(a=>a.id===id);if(!a||!['active','paused'].includes(a.state))throw new Error('This alert can no longer be edited.');const modal=new ModalBuilder().setCustomId(`edittarget:${id}`).setTitle('Edit your price target');modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('target').setLabel('New target price in coins').setValue(String(a.target)).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(8)));await i.showModal(modal);return;}
    if(i.customId.startsWith('removealert:')||i.customId.startsWith('alertstate:')){await i.deferReply({flags:MessageFlags.Ephemeral});const [action,id,state]=i.customId.split(':');if(action==='removealert'){if(!await alerts.remove(i.user.id,id))throw new Error('This alert cannot be cancelled.');}else{if(!['active','paused'].includes(state))return;const r=await alerts.pool.query('UPDATE futbot_alerts SET state=$1 WHERE id=$2 AND user_id=$3 AND state=$4 RETURNING id',[state,id,i.user.id,state==='active'?'paused':'active']);if(!r.rowCount)throw new Error('This alert has changed. Run /myalerts again.');}await i.editReply(await showAlerts(i.user.id));return;}

    const [action,id,arg,platformArg]=i.customId.split(':');if(!/^\d+$/.test(id||''))return;
    const actionPlatform=(platformArg==='pc'||platformArg==='ps5')?platformArg:(arg==='pc'||arg==='ps5')?arg:platform;
    if(action==='watch'){await i.deferReply({flags:MessageFlags.Ephemeral});await resolveCard(id);const p=await prices.latest(id,actionPlatform),start=p&&isFresh(p.capturedAt,maxAge)?p.value:null;await watch(alerts.pool,i.user.id,id,year,actionPlatform,(await benefits(alerts.pool,i.user.id)).watch,start);await i.editReply(`⭐ ${actionPlatform.toUpperCase()} card added to your private watchlist${start?` at ${coins(start)} coins`:''}. Use /watchlist or /dashboard.`);return;}
    if(action==='newalert'||action==='abovealert'){
      const modal=new ModalBuilder().setCustomId(`alertmodal:${id}:${action==='abovealert'?'above':'below'}:${actionPlatform}`).setTitle('Set your price target');
      const target=new TextInputBuilder().setCustomId('target').setLabel(action==='abovealert'?'Notify at or above this price (coins)':'Notify at or below this price (coins)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(8);
      modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(target));await i.showModal(modal);return;
    }
    if(action==='history'){await i.deferReply({flags:MessageFlags.Ephemeral});await i.editReply(await showPrice(await resolveCard(id),arg==='168'?168:24,actionPlatform));return;}
  }
  if(i.isModalSubmit()&&i.customId.startsWith('edittarget:')){await i.deferReply({flags:MessageFlags.Ephemeral});const id=i.customId.split(':')[1],a=(await alerts.list(i.user.id)).find(a=>a.id===id);if(!a)throw new Error('Alert not found.');await alerts.edit(i.user.id,id,Number(i.fields.getTextInputValue('target')),a.direction);await i.editReply(await showAlerts(i.user.id));return;}
  if(i.isModalSubmit()&&i.customId.startsWith('miscmodal:')){await i.deferReply({flags:MessageFlags.Ephemeral});const [,type,id,direction,pricePlatform]=i.customId.split(':');if(!isMiscItemType(type))throw new Error('Choose a valid consumable.');const target=Number(i.fields.getTextInputValue('target')),latest=await prices.miscLatest(type,id,pricePlatform);if(!Number.isInteger(target)||target<1||target>15000000)throw new Error('Choose a valid target price.');if(!latest||latest.price===null||latest.price<=0||!isFresh(latest.last_checked_at??latest.captured_at,Math.max(30,maxAge)))throw new Error('No fresh listed price is available for this item.');const itemLabel=latest.display_name||miscCatalog.label(type,id);await alerts.createMisc({userId:i.user.id,year,platform:pricePlatform,itemType:type,itemId:id,itemLabel,direction:direction as Direction,target,baseline:latest.price},(await benefits(alerts.pool,i.user.id)).alerts);await i.editReply(`🔔 Watching ${itemLabel} on ${pricePlatform.toUpperCase()} from ${coins(latest.price)} coins. You’ll get one DM when it reaches ${direction} ${coins(target)}.`);return;}
  if(i.isModalSubmit()&&i.customId.startsWith('alertmodal:')){await i.deferReply({flags:MessageFlags.Ephemeral});const [,id,direction,pricePlatform]=i.customId.split(':');await i.editReply({embeds:[await createAlert(i,id,direction==='above'?'above':'below',Number(i.fields.getTextInputValue('target')),pricePlatform)]});return;}
  if(!i.isChatInputCommand())return;
  await i.deferReply({flags:!['price','consumable','consumables','flip','fodder','movers','budget','compare','evolutions','gallery'].includes(i.commandName)?MessageFlags.Ephemeral:undefined});
  if(extraCommands.some(c=>c.name===i.commandName)){await handleTool(i,market,alerts,brand,resolveCard,await benefits(alerts.pool,i.user.id));return;}
  if(i.commandName==='tradepost'){
   if(!i.guildId)throw new Error('Run this command inside your Discord server.');
   if(!await hasTraderRole(i.guildId,i.user.id))throw new Error('Only members with the Trader role can create or manage auto trade posts.');
   const sub=i.options.getSubcommand();
   if(sub==='set'){
    const card=await resolveCard(i.options.getString('player',true)),pricePlatform=i.options.getString('platform',true) as 'ps5'|'pc';
    const triggerType=i.options.getString('trigger',true) as 'price'|'drop_pct',amount=i.options.getInteger('amount',true);
    const sellPrice=i.options.getInteger('sell'),channel=i.options.getChannel('channel',true);
    const access=await tradePostAccess(i.guildId,i.user.id,channel.id);
    if(!access.trader)throw new Error('Only members with the Trader role can create auto trade posts.');
    if(!access.channel)throw new Error('Choose a channel you can post in where FutBot has View Channel, Send Messages, Embed Links and Attach Files.');
    const latest=await prices.latest(card.id,pricePlatform);
    if(!latest||!isFresh(latest.capturedAt,maxAge))throw new Error('There is no fresh BIN for this card and market. Try again after the next price update.');
    const buyPrice=tradeBuyPrice(triggerType,amount,latest.value);
    if(buyPrice>=latest.value)throw new Error('The buy trigger must be below the current BIN, or it would post immediately.');
    if(sellPrice!==null&&sellPrice<=buyPrice)throw new Error('The sell target must be higher than the buy price.');
    const id=await createTradePost(alerts.pool,{guildId:i.guildId,userId:i.user.id,channelId:channel.id,cardId:card.id,cardName:card.name,year,platform:pricePlatform,triggerType,triggerValue:amount,baselinePrice:latest.value,buyPrice,sellPrice,note:i.options.getString('note')??''});
    const triggerText=triggerType==='price'?`BIN at or below ${coins(buyPrice)}`:`${amount}% drop from ${coins(latest.value)} to ${coins(buyPrice)}`;
    await i.editReply(`✅ Auto post #${id} set for **${card.name}**. Trigger: ${triggerText} coins on ${pricePlatform.toUpperCase()}. Destination: <#${channel.id}>. FutBot will post once when a fresh price meets it.`);return;
   }
   if(sub==='list'){
    const rows=await listTradePosts(alerts.pool,i.guildId,i.user.id);
    const body=rows.map(r=>`**#${r.id} · ${String(r.card_name).replace(/[*_`~|\\]/g,'')}** · ${String(r.platform).toUpperCase()} · buy ≤ ${coins(Number(r.buy_price))}${r.sell_price?` · sell ${coins(Number(r.sell_price))}`:''} · <#${r.channel_id}> · ${String(r.state).toUpperCase()}`).join('\n')||'You have no active or recent auto posts.';
    await i.editReply({embeds:[brand().setTitle('YOUR AUTO TRADE POSTS').setDescription(body)]});return;
   }
   if(sub==='cancel'){await cancelTradePost(alerts.pool,i.guildId,i.user.id,i.options.getString('id',true));await i.editReply('✅ Auto trade post cancelled.');return;}
  }
  if(i.commandName==='testdm'){try{await i.user.send({embeds:[brand().setTitle('NOTIFICATIONS / CONNECTED').setDescription('FutBot can reach your DMs. Price alerts will arrive here when a fresh observed price meets your target.')]});await i.editReply('Test notification sent. Check your DMs.');}catch{await i.editReply('I could not send you a DM. Enable direct messages from this server, check that FutBot is not blocked, then run /testdm again.');}}
  if(i.commandName==='consumable'){const type=i.options.getString('type',true) as MiscItemType,itemId=i.options.getString('item',true),pricePlatform=i.options.getString('platform')??platform;await i.editReply(await showMiscPrice(type,itemId,24,pricePlatform));}
  if(i.commandName==='price')await i.editReply(await showPrice(await resolveCard(i.options.getString('player',true)),24,i.options.getString('platform')??platform));
  if(i.commandName==='flip')await i.editReply(await createFlipPost(i,await resolveCard(i.options.getString('player',true)),i.options.getString('platform',true)));
  if(i.commandName==='alert')await i.editReply({embeds:[await createAlert(i,i.options.getString('player',true),i.options.getString('direction',true) as Direction,i.options.getInteger('target',true))]});
  if(i.commandName==='myalerts')await i.editReply(await showAlerts(i.user.id));
  if(i.commandName==='editalert'){const id=i.options.getString('id',true),a=(await alerts.list(i.user.id)).find(a=>a.id===id);if(!a)throw new Error('Alert not found.');await alerts.edit(i.user.id,id,i.options.getInteger('target',true),(i.options.getString('direction')??a.direction) as Direction);await i.editReply(await showAlerts(i.user.id));}
  if(i.commandName==='serverpro'){if(!i.guildId)throw new Error('Run this command inside your server.');const m=await membership(i.guildId,i.user.id,true);if(!m)throw new Error('Server membership could not be verified.');await claimSeat(alerts.pool,i.guildId,i.user.id,m.roles);await i.editReply('✅ Server Pro seat claimed. You now have 25 price alerts and 100 watchlist spaces.');}
  if(i.commandName==='serverwatchlist'){if(!i.guildId)throw new Error('Run this command inside your server.');await requireServerPlan(alerts.pool,i.guildId);const id=i.options.getString('list');if(!id){const lists=(await alerts.pool.query('SELECT id,name FROM futbot_shared_lists WHERE guild_id=$1 ORDER BY id',[i.guildId])).rows;await i.editReply({embeds:[brand().setTitle('⭐ SERVER WATCHLISTS').setDescription(lists.map(l=>`**#${l.id} · ${l.name}**`).join('\n')||'Your admins have not created any shared lists yet.').addFields({name:'OPEN A LIST',value:'Use /serverwatchlist list:ID. Select a card to check its price, watch it or set a private alert.'})]});}else{if(!/^\d+$/.test(id))throw new Error('Choose a numeric list ID.');const cards=await sharedCards(alerts.pool,id,i.guildId,market);await i.editReply({embeds:[brand().setTitle('⭐ SHARED SERVER WATCHLIST').setDescription(cards.map(c=>`**${c.name} · ${c.rating} ${c.position}** — ${coins(c.value)} 🪙`).join('\n')||'No fresh-priced cards in this list.')],components:cards.length?[new ActionRowBuilder<any>().addComponents(new (await import('discord.js')).StringSelectMenuBuilder().setCustomId('feedcard').setPlaceholder('Choose a card').addOptions(cards.map(c=>({label:`${c.name} · ${c.rating}`.slice(0,100),value:c.id}))))]:[]});}}
  if(i.commandName==='removealert'){const id=i.options.getString('id',true);if(!/^\d+$/.test(id))throw new Error('Enter the numeric alert ID.');await i.editReply(await alerts.remove(i.user.id,id)?'Alert cancelled.':'No cancellable alert with that ID belongs to you. Queued notifications cannot be cancelled.');}
  if(i.commandName==='tax'){const buy=i.options.getInteger('buy',true),sell=i.options.getInteger('sell',true),quantity=i.options.getInteger('quantity')||1,r=tradeProfit(buy,sell,quantity);await i.editReply({embeds:[brand().setTitle('🧮 YOUR TRADE RECEIPT').setDescription(`**${quantity} cop${quantity===1?'y':'ies'}** · Buy ${coins(buy)} / Sell ${coins(sell)}`).addFields({name:'PROFIT AFTER TAX',value:(r.profit>=0?'+':'')+coins(r.profit)+' coins',inline:true},{name:'TOTAL EA TAX',value:coins(r.tax)+' coins',inline:true},{name:'BREAK-EVEN / COPY',value:coins(r.breakEven)+' coins',inline:true}).setImage('attachment://receipt.png')],files:[new AttachmentBuilder(await tradeReceipt(buy,sell,quantity),{name:'receipt.png'})]});}

}
client.on('interactionCreate',i=>{(async()=>i.guildId&&(await serverPlan(alerts.pool,i.guildId)).feeds?guildSettings(alerts.pool,i.guildId):defaultBrand)().then(b=>context.run(b,()=>handle(i))).catch(async e=>{const message=e instanceof Error&& !('code' in e)?e.message:'Something went wrong. Please try again shortly.';if(i.isAutocomplete()){await i.respond([]).catch(()=>{});return;}if(i.isRepliable()){if(i.deferred||i.replied)await i.editReply({content:message,embeds:[],components:[]}).catch(()=>{});else await i.reply({content:message,flags:MessageFlags.Ephemeral}).catch(()=>{});}});});
let timer:NodeJS.Timeout|undefined,feedTimer:NodeJS.Timeout|undefined,catalogTimer:NodeJS.Timeout|undefined,tradePostTimer:NodeJS.Timeout|undefined,busy=false,feedBusy=false,tradePostBusy=false;
let web:Server|undefined;
client.on('error',e=>console.error('Discord client error:',e.message));
client.once('clientReady',()=>{void startBot().catch(async e=>{console.error('FutBot startup failed:',e?.code===10004?'DISCORD_GUILD_ID is inaccessible. Check the server ID and invite this bot, or remove DISCORD_GUILD_ID for global commands.':e instanceof Error?e.message:'Unknown startup error');await stop(1);});});
async function startBot(){
  const guildId=process.env.DISCORD_GUILD_ID;
  if(guildId){const guild=await client.guilds.fetch(guildId);await guild.commands.set(commands.map(c=>c.toJSON()));}
  else await client.application!.commands.set(commands.map(c=>c.toJSON()));
  if(process.env.WEB_ENABLED==='true')web=startWeb(prices,alerts,market);
  void miscCatalog.refresh().then(count=>console.log(`Misc item catalogue refreshed · ${count} managers`)).catch(e=>logFailure('Misc item catalogue refresh failed; saved names remain available',e));
  catalogTimer=setInterval(()=>void miscCatalog.refresh().catch(e=>logFailure('Misc item catalogue refresh failed; saved names remain available',e)),24*60*60*1000);
  console.log(`FutBot ready · FC${year} · ${platform} · ${commands.length} commands`);
  const tick=async()=>{if(busy)return;busy=true;try{await alertTick(alerts,prices,maxAge,async(userId,a,value,at)=>{
    const user=await client.users.fetch(userId);const card=await prices.card(a.card_id).catch(()=>null);const b=await guildSettings(alerts.pool,(a as any).guild_id);await context.run(b,()=>user.send({nonce:`fb${a.id}`,enforceNonce:true,components:[new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`history:${a.card_id}:24:${a.platform}`).setLabel('View price & chart').setStyle(ButtonStyle.Primary),new ButtonBuilder().setCustomId(`watch:${a.card_id}:${a.platform}`).setLabel('Watch card').setStyle(ButtonStyle.Secondary),new ButtonBuilder().setCustomId(`newalert:${a.card_id}:${a.platform}`).setLabel('Set another target').setStyle(ButtonStyle.Secondary))],embeds:[brand(a.platform).setThumbnail(card?.image?.startsWith('https://')?card.image:null).setTitle('🔔 YOUR PRICE TARGET WAS REACHED').setDescription(`**${a.card_name}** · ${card?.rating??'—'} ${card?.position??''} · ${card?.rarity??'Player item'} · ${a.platform.toUpperCase()}`).addFields({name:'Observed price',value:coins(value)+' coins',inline:true},{name:'Your target',value:`${a.direction} ${coins(Number(a.target))}`,inline:true},{name:'Observed',value:`<t:${Math.floor(at.getTime()/1000)}:R>`})]}));
  });await fodderAlertTick(alerts,prices,maxAge,async(userId,a,value,at)=>{const user=await client.users.fetch(userId);await user.send({nonce:`fbf${a.id}`,enforceNonce:true,embeds:[brand(a.platform).setTitle('🧱 FODDER DROP ALERT').setDescription(`**${a.rating}-rated fodder index** on **${a.platform.toUpperCase()}** has reached your target.`).addFields({name:'Current index',value:coins(value)+' coins',inline:true},{name:'Your trigger',value:`Down ${Number(a.drop_percent).toFixed(1)}% · ${coins(Number(a.baseline_price))} → ${coins(Number(a.target_price))}`,inline:true},{name:'Observed',value:`<t:${Math.floor(at.getTime()/1000)}:R>`}).setFooter({text:'Median of the 3 cheapest fresh tradeable cards at this rating'})]});});await miscAlertTick(alerts,prices,maxAge,async(userId,a,value,at)=>{const user=await client.users.fetch(userId),latest=await prices.miscLatest(a.item_type,a.item_id,a.platform).catch(()=>null),label=latest?.display_name||miscCatalog.label(a.item_type,a.item_id);await user.send({nonce:`fbm${a.id}`,enforceNonce:true,components:[new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`mischistory:${a.item_type}:${a.item_id}:168:${a.platform}`).setLabel('View 7-day chart').setStyle(ButtonStyle.Primary),new ButtonBuilder().setCustomId(`miscwatch:${a.item_type}:${a.item_id}:${a.platform}`).setLabel('Watch item').setStyle(ButtonStyle.Secondary))],embeds:[brand(a.platform).setTitle('🧴 CONSUMABLE PRICE ALERT').setDescription(`**${label}** on **${a.platform.toUpperCase()}** reached your target.`).addFields({name:'Current price',value:coins(value)+' coins',inline:true},{name:'Your target',value:`${a.direction} ${coins(Number(a.target_price))}`,inline:true},{name:'Saved from',value:coins(Number(a.baseline_price))+' coins',inline:true},{name:'Observed',value:`<t:${Math.floor(at.getTime()/1000)}:R>`}).setFooter({text:'One-shot alert · observed market price'})]});});}catch(error){logFailure('Alert cycle failed',error);}finally{busy=false;}};
  timer=setInterval(()=>void tick(),pollMs);await tick();
  const tradePostCycle=async()=>{if(tradePostBusy)return;tradePostBusy=true;try{await tradePostTick(alerts.pool,prices,maxAge,sendTradePost);}catch(e){logFailure('Trade post scheduler failed',e);}finally{tradePostBusy=false;}};
  tradePostTimer=setInterval(()=>void tradePostCycle(),pollMs);await tradePostCycle();
  const feedCycle=async()=>{if(feedBusy)return;feedBusy=true;try{await feedTick(alerts.pool,market,process.env.DISCORD_TOKEN!,feedPermission);}catch(e){logFailure('Feed scheduler failed',e);}finally{feedBusy=false;}};
  feedTimer=setInterval(()=>void feedCycle(),60000);await feedCycle();
}
async function stop(code=0){if(web)web.close();if(timer)clearInterval(timer);if(feedTimer)clearInterval(feedTimer);if(catalogTimer)clearInterval(catalogTimer);if(tradePostTimer)clearInterval(tradePostTimer);client.destroy();await Promise.all([prices.pool.end(),alerts.pool.end()]);process.exit(code);}
process.on('SIGTERM',()=>{console.log('Received SIGTERM; shutting down FutBot.');void stop();});process.on('SIGINT',()=>{console.log('Received SIGINT; shutting down FutBot.');void stop();});
await Promise.all([prices.pool.query('SELECT 1'),alerts.pool.query('SELECT 1 FROM futbot_alerts LIMIT 0')]);
await client.login(process.env.DISCORD_TOKEN);

