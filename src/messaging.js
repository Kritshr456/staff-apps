import { PermissionFlagsBits as P, ChannelType } from 'discord.js';
import { AppError } from './store.js';
import { reviewMessage } from './presentation.js';

export async function reviewChannel(guild, channelId, roleId) {
  const channel = await guild.channels.fetch(channelId), role = await guild.roles.fetch(roleId);
  if (!channel || channel.type !== ChannelType.GuildText || !role || role.id === guild.id)
    throw new AppError('Review channel or staff role is missing.');
  if (channel.permissionsFor(guild.roles.everyone)?.has(P.ViewChannel))
    throw new AppError('Review channel must deny View Channel to everyone.');
  if (!channel.permissionsFor(role)?.has(P.ViewChannel))
    throw new AppError('The reviewer role cannot see the review channel.');
  const bot = await guild.members.fetchMe();
  if (!channel.permissionsFor(bot)?.has([P.ViewChannel, P.SendMessages, P.EmbedLinks, P.ReadMessageHistory]))
    throw new AppError('The bot needs View Channel, Send Messages, Embed Links and Read Message History in the review channel.');
  return channel;
}

export function createPublisher(store) {
  const pending = new Map();
  return async (guild, id) => {
    const key = `${guild.id}:${id}`, previous = pending.get(key) || Promise.resolve();
    const job = previous.catch(() => {}).then(async () => {
      let a = store.get(guild.id, id);
      if (!a) throw new AppError('Application not found.');
      const channel = await reviewChannel(guild, a.channel, a.role);
      const message = a.message ? await channel.messages.fetch(a.message).catch(() => null) : null;
      // Discord calls can yield while another interaction changes the saved application.
      a = store.get(guild.id, id);
      if (message) await message.edit(reviewMessage(a));
      else {
        const sent = await channel.send(reviewMessage(a));
        store.setMessage(guild.id, id, sent.id);
      }
    });
    pending.set(key, job);
    try { await job; }
    finally { if (pending.get(key) === job) pending.delete(key); }
  };
}
