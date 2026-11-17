import { SlashCommandBuilder,PermissionFlagsBits as P,ChannelType } from 'discord.js';
function cmd(name,description,manager=false){const c=new SlashCommandBuilder().setName(name).setDescription(description).setDMPermission(false);if(manager)c.setDefaultMemberPermissions(P.ManageGuild);return c;}
const name=c=>c.addStringOption(o=>o.setName('name').setDescription('Template name').setMaxLength(24).setRequired(true));
const id=c=>c.addIntegerOption(o=>o.setName('id').setDescription('Application ID').setMinValue(1).setRequired(true));
export const commands=[
 name(cmd('app-template','Create or update a staff application template',true))
   .addRoleOption(o=>o.setName('reviewer').setDescription('Reviewer role').setRequired(true))
   .addChannelOption(o=>o.setName('channel').setDescription('Private review channel').addChannelTypes(ChannelType.GuildText).setRequired(true)),
 name(cmd('app-question','Append a question',true)).addStringOption(o=>o.setName('prompt').setDescription('Question text').setMaxLength(100).setRequired(true)),
 name(cmd('app-remove-question','Remove a question',true)).addIntegerOption(o=>o.setName('number').setDescription('Question number').setMinValue(1).setMaxValue(5).setRequired(true)),
 name(cmd('app-toggle','Open or close applications',true)).addBooleanOption(o=>o.setName('open').setDescription('Accept new submissions').setRequired(true)),
 name(cmd('app-panel','Post an application panel here',true)),
 cmd('app-templates','List configured templates and questions',true),
 id(cmd('app-view','View an application privately')),
 id(cmd('app-withdraw','Withdraw your pending application')),
 id(cmd('app-post','Post or refresh the review message')),
 id(cmd('app-review','Review an application')).addStringOption(o=>o.setName('decision').setDescription('Decision').addChoices({name:'Accept',value:'accepted'},{name:'Deny',value:'denied'}).setRequired(true)).addStringOption(o=>o.setName('note').setDescription('Optional note visible to the applicant').setMaxLength(250)),
 id(cmd('app-claim','Claim an application for review')),
 id(cmd('app-unclaim','Release your claim; managers can release any claim')),
 id(cmd('app-followup','Ask the applicant a follow-up question')).addStringOption(o=>o.setName('question').setDescription('Question for the applicant').setMaxLength(300).setRequired(true)),
 id(cmd('app-followup-cancel','Cancel an unanswered follow-up request')),
 id(cmd('app-followups','View an application’s follow-up conversation')),
 id(cmd('app-respond','Answer your pending follow-up in a private form')),
 id(cmd('app-audit','View the reviewer-only audit trail')).addIntegerOption(o=>o.setName('page').setDescription('Audit page, newest first').setMinValue(1).setMaxValue(100000)),
 name(cmd('app-cooldown','Set the reapplication cooldown',true)).addIntegerOption(o=>o.setName('minutes').setDescription('0 disables cooldown; up to 30 days').setMinValue(0).setMaxValue(43200).setRequired(true)),
 cmd('app-history','View your application history'),
];
