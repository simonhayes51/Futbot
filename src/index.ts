import {benefits,membership,feedPermission} from './community.js';
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
import {guildSettings,defaultBrand,watch,type GuildSettings} from './settings.js';
import { Client, MessageFlags, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, type Interaction } from 'discord.js';
import { PriceRepository } from './prices.js';
import { AlertRepository,alertTick,type Alert } from './alerts.js';
import { coins,isFresh,tradeProfit,type Direction,type Card } from './domain.js';
import { marketChart } from './chart.js';
import {tradeReceipt} from './boards.js';

for(const key of ['PRICE_DATABASE_URL','APP_DATABASE_URL','DISCORD_TOKEN'])if(!process.env[key])throw new Error(`Missing ${key}. See .env.example.`);
if(process.env.PRICE_DATABASE_URL===process.env.APP_DATABASE_URL)throw new Error('Use a separate application database');
const year=Number(process.env.GAME_YEAR||27),platform=process.env.PLATFORM||'ps5';
const maxAge=Number(process.env.MAX_PRICE_AGE_MINUTES||15),limit=Number(process.env.FREE_ALERT_LIMIT||3);
const pollMs=Math.max(15000,Number(process.env.ALERT_POLL_MS||30000));
if(![year,maxAge,limit,pollMs].every(Number.isFinite))throw new Error('Invalid numeric configuration');
const prices=new PriceRepository(process.env.PRICE_DATABASE_URL!,year);
const alerts=new AlertRepository(process.env.APP_DATABASE_URL!);
const client=new Client({intents:[GatewayIntentBits.Guilds]});
const context=new AsyncLocalStorage<GuildSettings>();
const market=new MarketService(prices,platform,maxAge);
const brand=(pricePlatform=platform)=>{const b=context.getStore()??defaultBrand;return new EmbedBuilder().setColor(b.accent as `#${string}`).setAuthor({name:b.name}).setFooter({text:`${b.footer} • FC${year} • ${pricePlatform.toUpperCase()}`});};
const playerOption=(o:any)=>o.setName('player').setDescription('Search a player and choose the exact card').setRequired(true).setAutocomplete(true);
const commands=[...extraCommands,
  new SlashCommandBuilder().setName('price').setDescription('Check a card price with artwork and market history').addStringOption(playerOption).addStringOption(o=>o.setName('platform').setDescription('Market for this price lookup').addChoices({name:'PS5 / Xbox · Console',value:'ps5'},{name:'PC',value:'pc'})),
  new SlashCommandBuilder().setName('flip').setDescription('Post a player flip with live market context and member actions')
    .addStringOption(playerOption)
    .addStringOption(o=>o.setName('platform').setDescription('Market for this flip').setRequired(true).addChoices({name:'PS5 / Xbox · Console',value:'ps5'},{name:'PC',value:'pc'}))
    .addStringOption(o=>o.setName('risk').setDescription('Your own risk rating').addChoices({name:'Low risk',value:'low'},{name:'Medium risk',value:'medium'},{name:'High risk',value:'high'}))
    .addIntegerOption(o=>o.setName('entry').setDescription('Your suggested buy price or max entry').setMinValue(1).setMaxValue(15000000))
    .addIntegerOption(o=>o.setName('target').setDescription('Your suggested sell target').setMinValue(1).setMaxValue(15000000))
    .addStringOption(o=>o.setName('note').setDescription('Why you like the flip (optional)').setMaxLength(240)),
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
async function handle(i:Interaction){
  if(i.isAutocomplete()){
    const q=i.options.getFocused();if(q.length<2){await i.respond([]);return;}
    const cards=await prices.search(q);await i.respond(cards.map(c=>({name:`${c.name} · ${c.rating??'?'} ${c.position??''} · ${c.rarity??''}`.slice(0,100),value:c.id})));return;
  }
  if(i.isStringSelectMenu()&&i.customId==='feedcard'){await i.deferReply({flags:MessageFlags.Ephemeral});await i.editReply(await showPrice(await resolveCard(i.values[0])));return;}
  if(i.isButton()){
    if(i.customId.startsWith('alertpage:')){await i.deferReply({flags:MessageFlags.Ephemeral});await i.editReply(await showAlerts(i.user.id,Number(i.customId.split(':')[1])));return;}
    if(i.customId.startsWith('editalert:')){const id=i.customId.split(':')[1],a=(await alerts.list(i.user.id)).find(a=>a.id===id);if(!a||!['active','paused'].includes(a.state))throw new Error('This alert can no longer be edited.');const modal=new ModalBuilder().setCustomId(`edittarget:${id}`).setTitle('Edit your price target');modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('target').setLabel('New target price in coins').setValue(String(a.target)).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(8)));await i.showModal(modal);return;}
    if(i.customId.startsWith('removealert:')||i.customId.startsWith('alertstate:')){await i.deferReply({flags:MessageFlags.Ephemeral});const [action,id,state]=i.customId.split(':');if(action==='removealert'){if(!await alerts.remove(i.user.id,id))throw new Error('This alert cannot be cancelled.');}else{if(!['active','paused'].includes(state))return;const r=await alerts.pool.query('UPDATE futbot_alerts SET state=$1 WHERE id=$2 AND user_id=$3 AND state=$4 RETURNING id',[state,id,i.user.id,state==='active'?'paused':'active']);if(!r.rowCount)throw new Error('This alert has changed. Run /myalerts again.');}await i.editReply(await showAlerts(i.user.id));return;}

    const [action,id,arg,platformArg]=i.customId.split(':');if(!/^\d+$/.test(id||''))return;
    const actionPlatform=(platformArg==='pc'||platformArg==='ps5')?platformArg:(arg==='pc'||arg==='ps5')?arg:platform;
    if(action==='watch'){await i.deferReply({flags:MessageFlags.Ephemeral});await resolveCard(id);await watch(alerts.pool,i.user.id,id,year,actionPlatform,(await benefits(alerts.pool,i.user.id)).watch);await i.editReply(`⭐ ${actionPlatform.toUpperCase()} card added to your private watchlist. Use /watchlist or /dashboard.`);return;}
    if(action==='newalert'||action==='abovealert'){
      const modal=new ModalBuilder().setCustomId(`alertmodal:${id}:${action==='abovealert'?'above':'below'}:${actionPlatform}`).setTitle('Set your price target');
      const target=new TextInputBuilder().setCustomId('target').setLabel(action==='abovealert'?'Notify at or above this price (coins)':'Notify at or below this price (coins)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(8);
      modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(target));await i.showModal(modal);return;
    }
    if(action==='history'){await i.deferReply({flags:MessageFlags.Ephemeral});await i.editReply(await showPrice(await resolveCard(id),arg==='168'?168:24,actionPlatform));return;}
  }
  if(i.isModalSubmit()&&i.customId.startsWith('edittarget:')){await i.deferReply({flags:MessageFlags.Ephemeral});const id=i.customId.split(':')[1],a=(await alerts.list(i.user.id)).find(a=>a.id===id);if(!a)throw new Error('Alert not found.');await alerts.edit(i.user.id,id,Number(i.fields.getTextInputValue('target')),a.direction);await i.editReply(await showAlerts(i.user.id));return;}
  if(i.isModalSubmit()&&i.customId.startsWith('alertmodal:')){await i.deferReply({flags:MessageFlags.Ephemeral});const [,id,direction,pricePlatform]=i.customId.split(':');await i.editReply({embeds:[await createAlert(i,id,direction==='above'?'above':'below',Number(i.fields.getTextInputValue('target')),pricePlatform)]});return;}
  if(!i.isChatInputCommand())return;
  await i.deferReply({flags:!['price','flip','fodder','movers','budget','compare'].includes(i.commandName)?MessageFlags.Ephemeral:undefined});
  if(extraCommands.some(c=>c.name===i.commandName)){await handleTool(i,market,alerts,brand,resolveCard,await benefits(alerts.pool,i.user.id));return;}
  if(i.commandName==='testdm'){try{await i.user.send({embeds:[brand().setTitle('NOTIFICATIONS / CONNECTED').setDescription('FutBot can reach your DMs. Price alerts will arrive here when a fresh observed price meets your target.')]});await i.editReply('Test notification sent. Check your DMs.');}catch{await i.editReply('I could not send you a DM. Enable direct messages from this server, check that FutBot is not blocked, then run /testdm again.');}}
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
let timer:NodeJS.Timeout|undefined,feedTimer:NodeJS.Timeout|undefined,busy=false,feedBusy=false;
let web:Server|undefined;
client.on('error',e=>console.error('Discord client error:',e.message));
client.once('clientReady',()=>{void startBot().catch(async e=>{console.error('FutBot startup failed:',e?.code===10004?'DISCORD_GUILD_ID is inaccessible. Check the server ID and invite this bot, or remove DISCORD_GUILD_ID for global commands.':e instanceof Error?e.message:'Unknown startup error');await stop(1);});});
async function startBot(){
  const guildId=process.env.DISCORD_GUILD_ID;
  if(guildId){const guild=await client.guilds.fetch(guildId);await guild.commands.set(commands.map(c=>c.toJSON()));}
  else await client.application!.commands.set(commands.map(c=>c.toJSON()));
  if(process.env.WEB_ENABLED==='true')web=startWeb(prices,alerts,market);
  console.log(`FutBot ready · FC${year} · ${platform} · ${commands.length} commands`);
  const tick=async()=>{if(busy)return;busy=true;try{await alertTick(alerts,prices,maxAge,async(userId,a,value,at)=>{
    const user=await client.users.fetch(userId);const card=await prices.card(a.card_id).catch(()=>null);const b=await guildSettings(alerts.pool,(a as any).guild_id);await context.run(b,()=>user.send({nonce:`fb${a.id}`,enforceNonce:true,components:[new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`history:${a.card_id}:24:${a.platform}`).setLabel('View price & chart').setStyle(ButtonStyle.Primary),new ButtonBuilder().setCustomId(`watch:${a.card_id}:${a.platform}`).setLabel('Watch card').setStyle(ButtonStyle.Secondary),new ButtonBuilder().setCustomId(`newalert:${a.card_id}:${a.platform}`).setLabel('Set another target').setStyle(ButtonStyle.Secondary))],embeds:[brand(a.platform).setThumbnail(card?.image?.startsWith('https://')?card.image:null).setTitle('🔔 YOUR PRICE TARGET WAS REACHED').setDescription(`**${a.card_name}** · ${card?.rating??'—'} ${card?.position??''} · ${card?.rarity??'Player item'} · ${a.platform.toUpperCase()}`).addFields({name:'Observed price',value:coins(value)+' coins',inline:true},{name:'Your target',value:`${a.direction} ${coins(Number(a.target))}`,inline:true},{name:'Observed',value:`<t:${Math.floor(at.getTime()/1000)}:R>`})]}));
  });}catch(error){logFailure('Alert cycle failed',error);}finally{busy=false;}};
  timer=setInterval(()=>void tick(),pollMs);await tick();
  const feedCycle=async()=>{if(feedBusy)return;feedBusy=true;try{await feedTick(alerts.pool,market,process.env.DISCORD_TOKEN!,feedPermission);}catch(e){logFailure('Feed scheduler failed',e);}finally{feedBusy=false;}};
  feedTimer=setInterval(()=>void feedCycle(),60000);await feedCycle();
}
async function stop(code=0){if(web)web.close();if(timer)clearInterval(timer);if(feedTimer)clearInterval(feedTimer);client.destroy();await Promise.all([prices.pool.end(),alerts.pool.end()]);process.exit(code);}
process.on('SIGTERM',()=>{console.log('Received SIGTERM; shutting down FutBot.');void stop();});process.on('SIGINT',()=>{console.log('Received SIGINT; shutting down FutBot.');void stop();});
await Promise.all([prices.pool.query('SELECT 1'),alerts.pool.query('SELECT 1 FROM futbot_alerts LIMIT 0')]);
await client.login(process.env.DISCORD_TOKEN);
