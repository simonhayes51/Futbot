import 'dotenv/config';
import { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, type Interaction } from 'discord.js';
import { PriceRepository } from './prices.js';
import { AlertRepository,alertTick,type Alert } from './alerts.js';
import { coins,isFresh,tradeProfit,type Direction,type Card } from './domain.js';
import { marketChart } from './chart.js';

for(const key of ['PRICE_DATABASE_URL','APP_DATABASE_URL','DISCORD_TOKEN'])if(!process.env[key])throw new Error(`Missing ${key}. See .env.example.`);
if(process.env.PRICE_DATABASE_URL===process.env.APP_DATABASE_URL)throw new Error('Use a separate application database');
const year=Number(process.env.GAME_YEAR||27),platform=process.env.PLATFORM||'ps5';
const maxAge=Number(process.env.MAX_PRICE_AGE_MINUTES||15),limit=Number(process.env.FREE_ALERT_LIMIT||3);
const pollMs=Math.max(15000,Number(process.env.ALERT_POLL_MS||30000));
if(![year,maxAge,limit,pollMs].every(Number.isFinite))throw new Error('Invalid numeric configuration');
const prices=new PriceRepository(process.env.PRICE_DATABASE_URL!,year);
const alerts=new AlertRepository(process.env.APP_DATABASE_URL!);
const client=new Client({intents:[GatewayIntentBits.Guilds]});
const brand=()=>new EmbedBuilder().setColor(0xb7f67b).setFooter({text:`FutBot • FC${year} • ${platform.toUpperCase()}`});
const playerOption=(o:any)=>o.setName('player').setDescription('Search a player and choose the exact card').setRequired(true).setAutocomplete(true);
const commands=[
  new SlashCommandBuilder().setName('price').setDescription('Check a card price with artwork and market history').addStringOption(playerOption),
  new SlashCommandBuilder().setName('alert').setDescription('Get a private DM when a card reaches your price').addStringOption(playerOption)
    .addStringOption(o=>o.setName('direction').setDescription('Target direction').setRequired(true).addChoices({name:'At or below',value:'below'},{name:'At or above',value:'above'}))
    .addIntegerOption(o=>o.setName('target').setDescription('Target price in coins').setRequired(true).setMinValue(1).setMaxValue(15000000)),
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
async function showPrice(card:Card,hours=24){
  const [price,history]=await Promise.all([prices.latest(card.id,platform),prices.history(card.id,platform,hours)]);
  const embed=brand().setTitle(`${card.name} · ${card.rating??'—'} ${card.position??''}`).setDescription(`${card.rarity||'Player item'}${card.club?' · '+card.club:''}`);
  if(card.image&&card.image.startsWith('https://'))embed.setThumbnail(card.image);
  const files:AttachmentBuilder[]=[];
  if(!price){embed.addFields({name:'Market price',value:'No price available for this market.'});return {embeds:[embed],files,components:[]};}
  const fresh=isFresh(price.capturedAt,maxAge),age=Math.floor(price.capturedAt.getTime()/1000);
  embed.addFields({name:'Market estimate',value:`**${coins(price.value)} coins**`,inline:true},{name:'Last observation',value:`<t:${age}:R>${fresh?'':' · STALE'}`,inline:true});
  if(history.length>1){const first=history[0].value,change=(price.value-first)/first*100;
    embed.addFields({name:`${hours}h movement`,value:`${change>=0?'+':''}${change.toFixed(1)}%`,inline:true});
    const png=await marketChart(`${card.name} · ${hours}h`,history);if(png){files.push(new AttachmentBuilder(png,{name:'market.png'}));embed.setImage('attachment://market.png');}
  }
  embed.addFields({name:'Price source',value:'Existing database · observed lowest BIN. Availability may change in-game.'});
  const row=new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`newalert:${card.id}`).setLabel('Set price alert').setStyle(ButtonStyle.Primary),new ButtonBuilder().setCustomId(`history:${card.id}:${hours===24?168:24}`).setLabel(hours===24?'7 day history':'24 hour history').setStyle(ButtonStyle.Secondary));
  return {embeds:[embed],files,components:[row]};
}
async function createAlert(i:any,value:string,direction:Direction,target:number){
  if(!Number.isInteger(target)||target<1||target>15000000)throw new Error('Enter a whole coin amount between 1 and 15,000,000.');
  const card=await resolveCard(value);
  const a=await alerts.create({userId:i.user.id,guildId:i.guildId,cardId:card.id,cardName:card.name,year,platform,direction,target},limit);
  return brand().setTitle('Your price alert is watching').setDescription(`**${card.name}** · ${platform.toUpperCase()}\nNotify at or ${direction} **${coins(target)} coins**.`).addFields({name:'Alert ID',value:String(a.id),inline:true},{name:'Manage',value:'Use /myalerts or /removealert. Enable DMs to receive notifications.'});
}
async function handle(i:Interaction){
  if(i.isAutocomplete()){
    const q=i.options.getFocused();if(q.length<2){await i.respond([]);return;}
    const cards=await prices.search(q);await i.respond(cards.map(c=>({name:`${c.name} · ${c.rating??'?'} ${c.position??''} · ${c.rarity??''}`.slice(0,100),value:c.id})));return;
  }
  if(i.isButton()){
    const [action,id,hours]=i.customId.split(':');if(!/^\d+$/.test(id||''))return;
    if(action==='newalert'){
      const modal=new ModalBuilder().setCustomId(`alertmodal:${id}`).setTitle('Set your price target');
      const target=new TextInputBuilder().setCustomId('target').setLabel('Notify at or below this price (coins)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(8);
      modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(target));await i.showModal(modal);return;
    }
    if(action==='history'){await i.deferReply({ephemeral:true});await i.editReply(await showPrice(await resolveCard(id),hours==='168'?168:24));return;}
  }
  if(i.isModalSubmit()&&i.customId.startsWith('alertmodal:')){await i.deferReply({ephemeral:true});await i.editReply({embeds:[await createAlert(i,i.customId.split(':')[1],'below',Number(i.fields.getTextInputValue('target')))]});return;}
  if(!i.isChatInputCommand())return;
  await i.deferReply({ephemeral:i.commandName!=='price'});
  if(i.commandName==='price')await i.editReply(await showPrice(await resolveCard(i.options.getString('player',true))));
  if(i.commandName==='alert')await i.editReply({embeds:[await createAlert(i,i.options.getString('player',true),i.options.getString('direction',true) as Direction,i.options.getInteger('target',true))]});
  if(i.commandName==='myalerts'){const rows=await alerts.list(i.user.id);await i.editReply({embeds:[brand().setTitle('Your saved alerts').setDescription(rows.length?rows.map(a=>`**#${a.id} · ${a.card_name}**\n${a.platform.toUpperCase()} · ${a.direction} ${coins(Number(a.target))} · ${a.state}`).join('\n\n'):'No saved alerts. Try /alert or use the button on /price.')]});}
  if(i.commandName==='removealert'){const id=i.options.getString('id',true);if(!/^\d+$/.test(id))throw new Error('Enter the numeric alert ID.');await i.editReply(await alerts.remove(i.user.id,id)?'Alert cancelled.':'No cancellable alert with that ID belongs to you. Queued notifications cannot be cancelled.');}
  if(i.commandName==='tax'){const r=tradeProfit(i.options.getInteger('buy',true),i.options.getInteger('sell',true),i.options.getInteger('quantity')||1);await i.editReply({embeds:[brand().setTitle('Your trade calculation').addFields({name:'Profit after tax',value:coins(r.profit)+' coins',inline:true},{name:'EA tax',value:coins(r.tax)+' coins',inline:true},{name:'Break-even / copy',value:coins(r.breakEven)+' coins',inline:true})]});}
}
client.on('interactionCreate',i=>{handle(i).catch(async e=>{const message=e instanceof Error&& !('code' in e)?e.message:'Something went wrong. Please try again shortly.';if(i.isAutocomplete()){await i.respond([]).catch(()=>{});return;}if(i.isRepliable()){if(i.deferred||i.replied)await i.editReply({content:message,embeds:[],components:[]}).catch(()=>{});else await i.reply({content:message,ephemeral:true}).catch(()=>{});}});});
let timer:NodeJS.Timeout|undefined,busy=false;
client.once('clientReady',async()=>{
  const guildId=process.env.DISCORD_GUILD_ID;
  if(guildId){const guild=await client.guilds.fetch(guildId);await guild.commands.set(commands.map(c=>c.toJSON()));}
  else await client.application!.commands.set(commands.map(c=>c.toJSON()));
  console.log(`FutBot ready · FC${year} · ${platform} · ${commands.length} commands`);
  const tick=async()=>{if(busy)return;busy=true;try{await alertTick(alerts,prices,maxAge,async(userId,a,value,at)=>{
    const user=await client.users.fetch(userId);await user.send({nonce:`fb${a.id}`,enforceNonce:true,embeds:[brand().setTitle('Your price target was reached').setDescription(`**${a.card_name}** · ${a.platform.toUpperCase()}`).addFields({name:'Observed price',value:coins(value)+' coins',inline:true},{name:'Your target',value:`${a.direction} ${coins(Number(a.target))}`,inline:true},{name:'Observed',value:`<t:${Math.floor(at.getTime()/1000)}:R>`})]});
  });}catch{console.error('Alert cycle failed. Check database connectivity.');}finally{busy=false;}};
  timer=setInterval(()=>void tick(),pollMs);await tick();
});
async function stop(){if(timer)clearInterval(timer);client.destroy();await Promise.all([prices.pool.end(),alerts.pool.end()]);process.exit(0);}
process.on('SIGTERM',()=>void stop());process.on('SIGINT',()=>void stop());
await Promise.all([prices.pool.query('SELECT 1'),alerts.pool.query('SELECT 1 FROM futbot_alerts LIMIT 0')]);
await client.login(process.env.DISCORD_TOKEN);
