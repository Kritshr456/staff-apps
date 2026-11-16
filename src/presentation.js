import { EmbedBuilder,ActionRowBuilder,ButtonBuilder,ButtonStyle } from 'discord.js';
export function reviewMessage(a){
 const embed=new EmbedBuilder().setTitle(`Application #${a.id} • ${a.name}`)
   .setDescription(`Applicant: <@${a.user}>\nStatus: ${a.status}${a.reviewer?`\nReviewer: <@${a.reviewer}>`:''}`)
   .setColor(a.status==='pending'?0x345b83:a.status==='accepted'?0x328257:0xa94442)
   .setFields(a.questions.map((q,index)=>({name:q,value:a.answers[index]})))
   .setTimestamp(new Date(a.created));
 if(a.note)embed.addFields({name:'Review note',value:a.note});
 const components=a.status==='pending'?[new ActionRowBuilder().addComponents(
   new ButtonBuilder().setCustomId(`review:accepted:${a.id}`).setLabel('Accept').setStyle(ButtonStyle.Success),
   new ButtonBuilder().setCustomId(`review:denied:${a.id}`).setLabel('Deny').setStyle(ButtonStyle.Danger),
 )]:[];
 return {embeds:[embed],components,allowedMentions:{parse:[]}};
}
