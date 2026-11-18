import { PermissionFlagsBits as P, ChannelType, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { AppError } from './store.js';
import { commands } from './commands.js';
import { applicationModal, responseModal, reviewMessage, followupMessage, responseButton, auditMessage, historyMessage, queueMessage } from './presentation.js';
import { reviewChannel } from './messaging.js';

const names = new Set(commands.map(c => c.name));
const canReview = (member, a) => member.permissions.has(P.ManageGuild) || member.roles.cache.has(a.role);
const isManager = member => member.permissions.has(P.ManageGuild);
function manager(member) { if (!isManager(member)) throw new AppError('Manage Server is required.'); }
function id(value) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) throw new AppError('Invalid application or follow-up ID.');
  return n;
}
function visible(store, guild, applicationId, member, user, staffOnly = false) {
  const a = store.get(guild, applicationId);
  if (!a || !(canReview(member, a) || (!staffOnly && a.user === user)))
    throw new AppError('Application not found or access denied.');
  return a;
}
export function createInteractionHandler({ store, publish, log = data => console.error('Application operation failed', data) }) {
  return async i => {
    if (!i.inGuild()) return;
    const chat = i.isChatInputCommand(), button = i.isButton(), modal = i.isModalSubmit();
    if (!(chat && names.has(i.commandName)) && !(button && /^(apply|review|claim|followups|respond|auditpage|queuepage):/.test(i.customId)) &&
      !(modal && /^(submit|followup-answer):/.test(i.customId))) return;
    const savedReply = async (a, message) => {
      let failed = false;
      try { await publish(i.guild, a.id); }
      catch (error) { failed = true; log({ id: a.id, code: error.code || 'delivery_failed' }); }
      await i.editReply(message + (failed ? ' Saved, but review-message delivery failed. Staff can retry with /app-post.' : ''));
    };
    try {
      if (button && i.customId.startsWith('apply:')) {
        return await i.showModal(applicationModal(store.draft(i.guildId, i.user.id, i.customId.slice(6))));
      }
      if ((chat && i.commandName === 'app-respond') || (button && i.customId.startsWith('respond:'))) {
        const parts = button ? i.customId.split(':') : null;
        const applicationId = id(parts ? parts[1] : i.options.getInteger('id', true));
        const request = store.responseRequest(i.guildId, applicationId, i.user.id);
        if (parts && id(parts[2]) !== request.id) throw new AppError('This response button is outdated. Use /app-respond to open the current request.');
        return await i.showModal(responseModal(request));
      }
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      if (modal) {
        if (i.customId.startsWith('followup-answer:')) {
          const a = store.answerFollowup(i.guildId, id(i.customId.slice(16)), i.user.id, i.fields.getTextInputValue('answer'));
          return await savedReply(a, `Follow-up answer saved for application #${a.id}.`);
        }
        const answers = [...i.fields.fields.values()].sort((a, b) => a.customId.localeCompare(b.customId)).map(f => f.value);
        const a = store.submit(i.guildId, i.user.id, id(i.customId.slice(7)), answers);
        return await savedReply(a, `Application #${a.id} submitted. Check /app-history for decisions or follow-up requests.`);
      }
      const member = await i.guild.members.fetch(i.user.id);
      if (button && i.customId.startsWith('auditpage:')) {
        const parts = i.customId.split(':'), applicationId = id(parts[1]), page = id(parts[2]);
        visible(store, i.guildId, applicationId, member, i.user.id, true);
        return await i.editReply(auditMessage(applicationId, store.audit(i.guildId, applicationId, page)));
      }
      if ((chat && i.commandName === 'app-queue') || (button && i.customId.startsWith('queuepage:'))) {
        const parts = button ? i.customId.split(':') : null;
        const result = store.reviewQueue({ guild: i.guildId, user: i.user.id, roles: [...member.roles.cache.keys()],
          isManager: isManager(member), name: parts ? decodeURIComponent(parts[3] || '') || null : i.options.getString('name'),
          filter: parts ? parts[2] : i.options.getString('filter') || 'all', page: parts ? id(parts[1]) : i.options.getInteger('page') || 1 });
        return await i.editReply(queueMessage(result));
      }
      if (button && i.customId.startsWith('followups:')) {
        const a = visible(store, i.guildId, id(i.customId.slice(10)), member, i.user.id);
        return await i.editReply(followupMessage(a, a.user === i.user.id));
      }
      if (chat && i.commandName === 'app-history') {
        const rows = store.history(i.guildId, i.user.id);
        return await i.editReply(historyMessage(rows));
      }
      if ((button && /^(claim|review):/.test(i.customId)) || (chat && [
        'app-claim', 'app-unclaim', 'app-followup', 'app-followup-cancel', 'app-review', 'app-withdraw',
        'app-view', 'app-post', 'app-followups', 'app-audit',
      ].includes(i.commandName))) {
        const parts = button ? i.customId.split(':') : null;
        const action = button ? (parts[0] === 'claim' ? 'app-claim' : 'app-review') : i.commandName;
        const applicationId = id(parts ? parts.at(-1) : i.options.getInteger('id', true));
        if (action === 'app-withdraw') {
          const a = store.withdraw(i.guildId, applicationId, i.user.id);
          return await savedReply(a, `Application #${a.id} withdrawn. Check /app-history for any reapplication cooldown.`);
        }
        const a = visible(store, i.guildId, applicationId, member, i.user.id, ['app-audit', 'app-post'].includes(action));
        if (action === 'app-view') return await i.editReply({ ...reviewMessage(a), components: a.user === i.user.id ? responseButton(a) : [] });
        if (action === 'app-followups') return await i.editReply(followupMessage(a, a.user === i.user.id));
        if (action === 'app-audit') return await i.editReply(auditMessage(a.id, store.audit(i.guildId, a.id, i.options.getInteger('page') || 1)));
        if (action === 'app-post') {
          await publish(i.guild, a.id); return await i.editReply('Review message posted or refreshed.');
        }
        const allowed = canReview(member, a);
        let updated, message;
        switch (action) {
          case 'app-claim': updated = store.claim(i.guildId, a.id, i.user.id, allowed); message = 'Application claimed.'; break;
          case 'app-unclaim': updated = store.unclaim(i.guildId, a.id, i.user.id, allowed, isManager(member)); message = 'Claim released.'; break;
          case 'app-followup': updated = store.askFollowup(i.guildId, a.id, i.user.id, allowed, i.options.getString('question', true)); message = 'Follow-up saved. The applicant can use /app-followups and /app-respond. No DM is sent.'; break;
          case 'app-followup-cancel': updated = store.cancelFollowup(i.guildId, a.id, i.user.id, allowed); message = 'Open follow-up cancelled.'; break;
          case 'app-review':
            updated = store.review(i.guildId, a.id, i.user.id, allowed, parts ? parts[1] : i.options.getString('decision', true), parts ? '' : i.options.getString('note') || '');
            message = `Application #${a.id} ${updated.status}. The applicant can view the decision with /app-history.`; break;
        }
        return await savedReply(updated, message);
      }
      manager(member);
      const name = i.options.getString('name');
      switch (i.commandName) {
        case 'app-template': {
          const role = i.options.getRole('reviewer', true), channel = i.options.getChannel('channel', true);
          if (role.managed) throw new AppError('Choose a regular reviewer role.');
          await reviewChannel(i.guild, channel.id, role.id); store.configure(i.guildId, name, role.id, channel.id); break;
        }
        case 'app-question': store.question(i.guildId, name, i.options.getString('prompt', true)); break;
        case 'app-edit-question': store.editQuestion(i.guildId, name, i.options.getInteger('number', true), i.options.getString('prompt', true)); break;
        case 'app-remove-question': store.removeQuestion(i.guildId, name, i.options.getInteger('number', true)); break;
        case 'app-toggle': store.toggle(i.guildId, name, i.options.getBoolean('open', true)); break;
        case 'app-cooldown': store.setCooldown(i.guildId, name, i.options.getInteger('minutes', true)); break;
        case 'app-templates': return await i.editReply(JSON.stringify(store.listTemplates(i.guildId), null, 2).slice(0, 1900));
        case 'app-panel': {
          const t = store.template(i.guildId, name);
          if (!t || !t.questions.length || !t.enabled) throw new AppError('Configure questions and open applications first.');
          if (i.channel?.type !== ChannelType.GuildText) throw new AppError('Post panels in a server text channel.');
          await i.channel.send({ content: `Apply for ${name}. Answers and follow-ups are saved and shared with the configured reviewers. Check /app-history for updates.`,
            components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`apply:${name}`).setLabel('Apply').setStyle(ButtonStyle.Primary))] }); break;
        }
      }
      await i.editReply('Saved.');
    } catch (error) {
      if (!(error instanceof AppError)) log({ code: error.code || 'unknown' });
      const content = error instanceof AppError ? error.message : 'The operation failed. Check bot permissions and try again.';
      try {
        if (i.deferred || i.replied) await i.editReply(content);
        else await i.reply({ content, flags: MessageFlags.Ephemeral });
      } catch { /* Interaction may have expired. */ }
    }
  };
}
