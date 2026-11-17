import { Client,GatewayIntentBits,Events,PermissionFlagsBits as P,ChannelType,MessageFlags,
 ActionRowBuilder,ButtonBuilder,ButtonStyle,ModalBuilder,TextInputBuilder,TextInputStyle } from 'discord.js';
import { openStore,AppError } from './store.js';
import { reviewMessage } from './presentation.js';
if(!process.env.DISCORD_TOKEN)throw Error('Missing DISCORD_TOKEN');
const store=openStore(process.env.DATABASE_PATH||'./data/app.sqlite');
const client=new Client({intents:[GatewayIntentBits.Guilds],allowedMentions:{parse:[]}});
const reviewer=(member,a)=>member.permissions.has(P.ManageGuild)||member.roles.cache.has(a.role);
function manager(member){if(!member.permissions.has(P.ManageGuild))throw new AppError('Manage Server is required.');}
async function reviewChannel(guild,channelId,roleId){
 const channel=await guild.channels.fetch(channelId);
 const role=await guild.roles.fetch(roleId);
 if(!channel||channel.type!==ChannelType.GuildText||!role||role.id===guild.id)throw new AppError('Review channel or staff role is missing.');
 if(channel.permissionsFor(guild.roles.everyone)?.has(P.ViewChannel))throw new AppError('Review channel must deny View Channel to everyone.');
 if(!channel.permissionsFor(role)?.has(P.ViewChannel))throw new AppError('The reviewer role cannot see the review channel.');
 const bot=await guild.members.fetchMe();
 if(!channel.permissionsFor(bot)?.has([P.ViewChannel,P.SendMessages,P.EmbedLinks,P.ReadMessageHistory]))throw new AppError('The bot needs View Channel, Send Messages, Embed Links and Read Message History in the review channel.');
 return channel;
}
async function publish(guild,a){
 const channel=await reviewChannel(guild,a.channel,a.role);
 let message=a.message?await channel.messages.fetch(a.message).catch(()=>null):null;
 if(message)await message.edit(reviewMessage(a));
 else {message=await channel.send(reviewMessage(a));store.setMessage(a.guild,a.id,message.id);}
}
client.on(Events.InteractionCreate,async i=>{
 if(!i.inGuild()||!(i.isChatInputCommand()||i.isButton()||i.isModalSubmit()))return;
 try{
   if(i.isButton()&&i.customId.startsWith('apply:')){
     const draft=store.draft(i.guildId,i.user.id,i.customId.slice(6));
     const modal=new ModalBuilder().setCustomId(`submit:${draft.id}`).setTitle('Staff application');
     for(const [index,question]of draft.questions.entries())modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder()
       .setCustomId(`q${index}`).setLabel(question.slice(0,45)).setPlaceholder(question).setStyle(TextInputStyle.Paragraph).setMaxLength(1000).setRequired(true)));
     return await i.showModal(modal);
   }
   if(i.isButton()&&!i.customId.startsWith('review:'))return;
   if(i.isModalSubmit()&&!i.customId.startsWith('submit:'))return;
   await i.deferReply({flags:MessageFlags.Ephemeral});
   const member=await i.guild.members.fetch(i.user.id);
   if(i.isModalSubmit()){
     const answers=[...i.fields.fields.values()].sort((a,b)=>a.customId.localeCompare(b.customId)).map(f=>f.value);
     const a=store.submit(i.guildId,i.user.id,Number(i.customId.slice(7)),answers);
     try{await publish(i.guild,a);await i.editReply(`Application #${a.id} submitted.`);}
     catch{console.error('Application saved but review delivery failed',{id:a.id});await i.editReply(`Application #${a.id} saved. Staff must use /app-post to retry review delivery.`);}
     return;
   }
   if(i.isChatInputCommand()&&i.commandName==='app-withdraw'){
     const updated=store.withdraw(i.guildId,i.options.getInteger('id',true),i.user.id);
     try{await publish(i.guild,updated);}catch{console.error('Withdrawal saved but message update failed',{id:updated.id});}
     return await i.editReply(`Application #${updated.id} withdrawn. You may submit a new application while the template is open.`);
   }
   if(i.isButton()||i.commandName==='app-review'){
     const parts=i.isButton()?i.customId.split(':'):null;
     const id=parts?Number(parts[2]):i.options.getInteger('id',true);
     const a=store.get(i.guildId,id);if(!a)throw new AppError('Application not found.');
     const updated=store.review(i.guildId,id,i.user.id,reviewer(member,a),parts?parts[1]:i.options.getString('decision',true),parts?'':i.options.getString('note')||'');
     try{await publish(i.guild,updated);}catch{console.error('Review saved but message update failed',{id});}
     return await i.editReply(`Application #${id} ${updated.status}. The applicant can view the decision with /app-history.`);
   }
   const name=i.options.getString('name');
   if(i.commandName==='app-history')return await i.editReply(store.history(i.guildId,i.user.id).map(a=>`#${a.id} ${a.name} • ${a.status}${a.note?` • ${a.note}`:''}`).join('\n').slice(0,1900)||'No applications yet.');
   if(['app-view','app-post'].includes(i.commandName)){
     const a=store.get(i.guildId,i.options.getInteger('id',true));
     if(!a||!(reviewer(member,a)||a.user===i.user.id))throw new AppError('Application not found or access denied.');
     if(i.commandName==='app-view')return await i.editReply({...reviewMessage(a),components:[]});
     if(!reviewer(member,a))throw new AppError('Only reviewers may post review messages.');
     await publish(i.guild,a);return await i.editReply('Review message posted or refreshed.');
   }
   manager(member);
   switch(i.commandName){
     case 'app-template':{
       const role=i.options.getRole('reviewer',true),channel=i.options.getChannel('channel',true);
       if(role.managed)throw new AppError('Choose a regular reviewer role.');
       await reviewChannel(i.guild,channel.id,role.id);store.configure(i.guildId,name,role.id,channel.id);break;
     }
     case 'app-question':store.question(i.guildId,name,i.options.getString('prompt',true));break;
     case 'app-remove-question':store.removeQuestion(i.guildId,name,i.options.getInteger('number',true));break;
     case 'app-toggle':store.toggle(i.guildId,name,i.options.getBoolean('open',true));break;
     case 'app-templates':return await i.editReply(JSON.stringify(store.listTemplates(i.guildId),null,2).slice(0,1900)||'No templates.');
     case 'app-panel':{
       const t=store.template(i.guildId,name);if(!t||!t.questions.length||!t.enabled)throw new AppError('Configure questions and open applications first.');
       if(i.channel?.type!==ChannelType.GuildText)throw new AppError('Post panels in a server text channel.');
       await i.channel.send({content:`Apply for ${name}. Answers are saved and shared with the configured reviewers.`,components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`apply:${name}`).setLabel('Apply').setStyle(ButtonStyle.Primary))]});break;
     }
     default:throw new AppError('Unknown command.');
   }
   await i.editReply('Saved.');
 }catch(error){
   if(!(error instanceof AppError))console.error('Application operation failed',{code:error.code??'unknown'});
   const content=error instanceof AppError?error.message:'The operation failed. Check bot permissions and try again.';
   try{if(i.deferred||i.replied)await i.editReply(content);else await i.reply({content,flags:MessageFlags.Ephemeral});}catch{ /* Interaction may have expired. */ }
 }
});
client.once(Events.ClientReady,()=>console.log('Staff application bot ready.'));
client.on(Events.Error,()=>console.error('Discord client error.'));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{client.destroy();store.close();});
await client.login(process.env.DISCORD_TOKEN);
