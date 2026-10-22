import type pg from 'pg';
import {createHash} from 'node:crypto';
import {SlashCommandBuilder,PermissionFlagsBits,ChannelType,EmbedBuilder,type ChatInputCommandInteraction,type Client} from 'discord.js';
import type {PriceRepository} from './prices.js';
import {isFresh,coins} from './domain.js';

export const autoFlipsCommand=new SlashCommandBuilder().setName('autoflips')
 .setDescription('Manage private automatic flip calls for this server')
 .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild).setDMPermission(false)
 .addSubcommand(s=>s.setName('set').setDescription('Send new automatic flip calls to a private channel')
  .addChannelOption(o=>o.setName('channel').setDescription('Private channel for the calls').setRequired(true).addChannelTypes(ChannelType.GuildText,ChannelType.GuildAnnouncement))
  .addStringOption(o=>o.setName('platform').setDescription('Trading market').setRequired(true).addChoices({name:'PS5 / Xbox · Console',value:'ps5'},{name:'PC',value:'pc'})))
 .addSubcommand(s=>s.setName('status').setDescription('See the saved channels and recent deliveries'))
 .addSubcommand(s=>s.setName('off').setDescription('Stop automatic flip calls for a market')
  .addStringOption(o=>o.setName('platform').setDescription('Market to stop').setRequired(true).addChoices({name:'PS5 / Xbox · Console',value:'ps5'},{name:'PC',value:'pc'})));

async function privateDestination(client:Client,guildId:string,channelId:string,userId?:string){
 const guild=await client.guilds.fetch(guildId),channel=await guild.channels.fetch(channelId,{force:true});
 if(!channel||![ChannelType.GuildText,ChannelType.GuildAnnouncement].includes(channel.type)||!('permissionOverwrites' in channel)||!('send' in channel))throw new Error('Choose a text channel in this server.');
 if(!channel.permissionOverwrites.cache.get(guildId)?.deny.has(PermissionFlagsBits.ViewChannel))throw new Error('Make this channel private: deny @everyone View Channel.');
 const bot=await guild.members.fetchMe({force:true});
 if(!channel.permissionsFor(bot)?.has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.EmbedLinks]))throw new Error('FutBot needs View Channel, Send Messages and Embed Links there.');
 if(userId&&!channel.permissionsFor(await guild.members.fetch(userId))?.has(PermissionFlagsBits.ViewChannel))throw new Error('Choose a private channel you can view.');
 return channel;
}

export async function handleAutoFlips(i:ChatInputCommandInteraction,pool:pg.Pool){
 if(!i.guildId||!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild))throw new Error('You need Manage Server permission to configure automatic flips.');
 const sub=i.options.getSubcommand();
 if(sub==='status'){
  const {rows}=await pool.query(`SELECT c.*, (SELECT count(*)::int FROM futbot_flip_outbox o WHERE o.guild_id=c.guild_id AND o.platform=c.platform AND o.state='pending') AS pending,
   (SELECT max(created_at) FROM futbot_flip_outbox o WHERE o.guild_id=c.guild_id AND o.platform=c.platform AND o.state='sent') AS last_sent
   FROM futbot_flip_channels c WHERE guild_id=$1 ORDER BY platform`,[i.guildId]);
  await i.editReply(rows.length?rows.map(r=>`**${r.platform.toUpperCase()}** · ${r.enabled?'On':'Off'} · <#${r.channel_id}> · ${r.pending} queued${r.last_sent?` · last sent <t:${Math.floor(new Date(r.last_sent).getTime()/1000)}:R>`:''}`).join('\n'):'Automatic flips are off. Use /autoflips set to choose a private channel.');return;
 }
 const platform=i.options.getString('platform',true);
 if(sub==='off'){
  await pool.query('UPDATE futbot_flip_channels SET enabled=false,updated_at=now() WHERE guild_id=$1 AND platform=$2',[i.guildId,platform]);
  await pool.query("UPDATE futbot_flip_outbox SET state='cancelled' WHERE guild_id=$1 AND platform=$2 AND state='pending'",[i.guildId,platform]);
  await i.editReply(`Automatic flips are off for ${platform.toUpperCase()} in this server.`);return;
 }
 const channel=i.options.getChannel('channel',true);
 await privateDestination(i.client,i.guildId,channel.id,i.user.id);
 await pool.query(`INSERT INTO futbot_flip_channels(guild_id,platform,channel_id,set_by) VALUES($1,$2,$3,$4)
  ON CONFLICT(guild_id,platform) DO UPDATE SET channel_id=EXCLUDED.channel_id,set_by=EXCLUDED.set_by,enabled=true,updated_at=now()`,[i.guildId,platform,channel.id,i.user.id]);
 await i.editReply(`✅ Automatic ${platform.toUpperCase()} flips enabled in <#${channel.id}>. FutBot will send new qualifying calls there. Use /autoflips status to check or /autoflips off to stop.`);
}

export type AutoFlipSignal={id:string;name:string|null;rating:number|null;rarity:string|null;entry:number;target:number;net:number;margin:number;episodes:number;sourceAt:number|string;reason:string};
export function validAutoFlipSignal(s:AutoFlipSignal){
 return s?.reason==='candidate'&&/^\d+$/.test(String(s.id))&&[s.entry,s.target,s.net,s.margin,s.episodes].every(Number.isFinite)&&
  s.entry>0&&s.target>s.entry&&s.net>=1500&&s.margin>=0.05&&s.episodes>=1&&Number.isFinite(new Date(s.sourceAt).getTime());
}

export async function autoFlipTick(pool:pg.Pool,prices:PriceRepository,maxAge:number,
 publish:(row:any,signal:AutoFlipSignal)=>Promise<string>){
 await pool.query("UPDATE futbot_flip_outbox SET state='cancelled',last_error='Signal expired or destination disabled.' WHERE state IN ('pending','posting') AND (source_at<now()-interval '30 minutes' OR NOT EXISTS(SELECT 1 FROM futbot_flip_channels c WHERE c.guild_id=futbot_flip_outbox.guild_id AND c.platform=futbot_flip_outbox.platform AND c.channel_id=futbot_flip_outbox.channel_id AND c.enabled))");
 const due=(await pool.query("SELECT signal_key,guild_id FROM futbot_flip_outbox WHERE state='pending' OR (state='posting' AND posting_at<now()-interval '5 minutes') ORDER BY created_at LIMIT 20")).rows;
 for(const candidate of due){
  const claimed=await pool.query("UPDATE futbot_flip_outbox SET state='posting',posting_at=now() WHERE signal_key=$1 AND guild_id=$2 AND (state='pending' OR (state='posting' AND posting_at<now()-interval '5 minutes')) RETURNING *",[candidate.signal_key,candidate.guild_id]);
  if(!claimed.rowCount)continue;
  const row=claimed.rows[0],signal=row.signal as AutoFlipSignal;
  try{
   if(!validAutoFlipSignal(signal)||row.game_year!==prices.year)throw new Error('Invalid signal or game year.');
   const latest=await prices.latest(signal.id,row.platform);
   if(!latest||!isFresh(latest.capturedAt,Math.min(30,maxAge))||latest.value>signal.entry){
    await pool.query("UPDATE futbot_flip_outbox SET state='cancelled',last_error='Buy BIN is no longer available or fresh.' WHERE signal_key=$1 AND guild_id=$2",[row.signal_key,row.guild_id]);continue;
   }
   const active=await pool.query('SELECT 1 FROM futbot_flip_channels WHERE guild_id=$1 AND platform=$2 AND channel_id=$3 AND enabled',[row.guild_id,row.platform,row.channel_id]);
   if(!active.rowCount){await pool.query("UPDATE futbot_flip_outbox SET state='cancelled' WHERE signal_key=$1 AND guild_id=$2",[row.signal_key,row.guild_id]);continue;}
   const messageId=await publish(row,signal);
   await pool.query("UPDATE futbot_flip_outbox SET state='sent',message_id=$3,last_error=NULL WHERE signal_key=$1 AND guild_id=$2",[row.signal_key,row.guild_id,messageId]);
  }catch(error){await pool.query("UPDATE futbot_flip_outbox SET attempts=attempts+1,state=CASE WHEN attempts+1>=3 THEN 'failed' ELSE 'pending' END,last_error=$3 WHERE signal_key=$1 AND guild_id=$2",[row.signal_key,row.guild_id,error instanceof Error?error.message.slice(0,200):'Delivery failed']);}
 }
 await pool.query("DELETE FROM futbot_flip_outbox WHERE created_at<now()-interval '7 days' AND state IN ('sent','cancelled','failed')");
}

export async function publishAutoFlip(client:Client,row:any,signal:AutoFlipSignal){
 const channel=await privateDestination(client,row.guild_id,row.channel_id);
 const embed=new EmbedBuilder().setColor('#3458ff').setTitle(`📈 BUY IDEA · ${signal.name||'Card '+signal.id}`.slice(0,256))
  .setDescription(`${signal.rating||'—'} · ${signal.rarity||'Player item'} · ${row.platform.toUpperCase()}`)
  .addFields({name:'Buy at or below',value:coins(signal.entry)+' coins',inline:true},{name:'Target BIN',value:coins(signal.target)+' coins',inline:true},
   {name:'Est. net after 5% tax',value:coins(signal.net)+' coins',inline:true},{name:'Why it qualified',value:`${signal.episodes} confirmed prior recovery · ${(signal.margin*100).toFixed(1)}% estimated margin`})
  .setFooter({text:`FutBot · FC${row.game_year} · BIN observations · check the market before buying`}).setTimestamp(new Date(signal.sourceAt));
 const nonce=createHash('sha256').update(row.signal_key+':'+row.guild_id).digest('hex').slice(0,24);
 const message=await channel.send({embeds:[embed],allowedMentions:{parse:[]},nonce,enforceNonce:true});return message.id;
}
