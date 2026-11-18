import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';

export function applicationModal(draft) {
  const modal = new ModalBuilder().setCustomId(`submit:${draft.id}`).setTitle('Staff application');
  for (const [index, question] of draft.questions.entries()) modal.addComponents(new ActionRowBuilder().addComponents(
    new TextInputBuilder().setCustomId(`q${index}`).setLabel(question.slice(0, 45)).setPlaceholder(question)
      .setStyle(TextInputStyle.Paragraph).setMaxLength(1000).setRequired(true),
  ));
  return modal;
}
export function responseModal(request) {
  return new ModalBuilder().setCustomId(`followup-answer:${request.id}`).setTitle('Follow-up response')
    .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('answer')
      .setLabel('Your response').setPlaceholder(request.question.slice(0, 100))
      .setStyle(TextInputStyle.Paragraph).setMaxLength(1000).setRequired(true)));
}
export function responseButton(a) {
  const open = a.followups?.find(f => f.status === 'open');
  if (!open || a.status !== 'pending') return [];
  return [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`respond:${a.id}:${open.id}`)
    .setLabel('Answer follow-up').setStyle(ButtonStyle.Primary))];
}
export function reviewMessage(a) {
  const followups = a.followups || [], open = followups.some(f => f.status === 'open');
  const description = [`Applicant: <@${a.user}>`, `Status: ${a.status}`];
  if (a.claimed_by) description.push(`Claimed by: <@${a.claimed_by}>`);
  if (a.reviewer) description.push(`Reviewer: <@${a.reviewer}>`);
  if (followups.length) description.push(`Follow-ups: ${followups.length}${open ? ' (awaiting reply)' : ''}`);
  const embed = new EmbedBuilder().setTitle(`Application #${a.id} • ${a.name}`)
    .setDescription(description.join('\n'))
    .setColor(a.status === 'pending' ? 0x345b83 : a.status === 'accepted' ? 0x328257 : a.status === 'withdrawn' ? 0x707780 : 0xa94442)
    .setFields(a.questions.map((q, index) => ({ name: q, value: a.answers[index] })))
    .setTimestamp(new Date(a.created));
  if (a.note) embed.addFields({ name: 'Review note', value: a.note });
  const buttons = [];
  if (a.status === 'pending') {
    buttons.push(new ButtonBuilder().setCustomId(`claim:${a.id}`).setLabel(a.claimed_by ? 'Claimed' : 'Claim')
      .setDisabled(Boolean(a.claimed_by)).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`review:accepted:${a.id}`).setLabel('Accept').setDisabled(open).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`review:denied:${a.id}`).setLabel('Deny').setDisabled(open).setStyle(ButtonStyle.Danger));
  }
  if (followups.length) buttons.push(new ButtonBuilder().setCustomId(`followups:${a.id}`).setLabel('View follow-ups').setStyle(ButtonStyle.Secondary));
  return { embeds: [embed], components: buttons.length ? [new ActionRowBuilder().addComponents(buttons)] : [], allowedMentions: { parse: [] } };
}
export function followupMessage(a, applicant = false) {
  const embed = new EmbedBuilder().setTitle(`Follow-ups • application #${a.id}`)
    .setDescription(a.followups.length ? `Status: ${a.status}. Original application answers are available with /app-view.` : 'No follow-up requests yet.')
    .setColor(0x345b83);
  for (const f of a.followups) {
    embed.addFields(
      { name: `#${f.id} Question • ${f.status} • by ${f.asked_by}`, value: f.question },
      { name: `#${f.id} Answer`, value: f.answer || (f.status === 'cancelled' ? 'Request cancelled.' : 'Awaiting the applicant’s response.') },
    );
  }
  return { embeds: [embed], components: applicant ? responseButton(a) : [], allowedMentions: { parse: [] } };
}
export function auditMessage(id, result) {
  const description = result.events.map(e => `#${e.id} • ${e.event} • <@${e.actor}> • ${new Date(e.created).toISOString()}\n${JSON.stringify(e.details)}`).join('\n\n');
  return { embeds: [new EmbedBuilder().setTitle(`Audit • application #${id}`)
    .setDescription(description || 'No events on this page. Auditing starts with v1.2.0; older actions were not backfilled.')
    .setFooter({ text: `Page ${result.page} • ${result.total} events • newest first` })], allowedMentions: { parse: [] } };
}

export function historyMessage(rows, now = Date.now()) {
  const embed = new EmbedBuilder().setTitle('Your applications').setColor(0x345b83);
  if (!rows.length) embed.setDescription('No applications yet.');
  for (const a of rows) {
    const lines = [`Submitted: ${new Date(a.created).toISOString()}`];
    if (a.awaiting_reply) lines.push(`Awaiting your reply: /app-followups id:${a.id}`);
    if (a.note) lines.push(a.note);
    if (a.cooldown_until) {
      const label = a.cooldown_until > now ? 'Reapply after' : 'Cooldown ended';
      lines.push(`${label}: ${new Date(a.cooldown_until).toISOString()}`);
    }
    embed.addFields({ name: `#${a.id} ${a.name} • ${a.status}`, value: lines.join('\n') });
  }
  return { embeds: [embed], allowedMentions: { parse: [] } };
}
