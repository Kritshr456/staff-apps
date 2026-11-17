import { Client, GatewayIntentBits, Events } from 'discord.js';
import { openStore } from './store.js';
import { createPublisher } from './messaging.js';
import { createInteractionHandler } from './interactions.js';

if (!process.env.DISCORD_TOKEN) throw Error('Missing DISCORD_TOKEN');
const store = openStore(process.env.DATABASE_PATH || './data/app.sqlite');
const client = new Client({ intents: [GatewayIntentBits.Guilds], allowedMentions: { parse: [] } });
client.on(Events.InteractionCreate, createInteractionHandler({ store, publish: createPublisher(store) }));
client.once(Events.ClientReady, () => console.log('Staff application bot ready.'));
client.on(Events.Error, () => console.error('Discord client error.'));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { client.destroy(); store.close(); });
await client.login(process.env.DISCORD_TOKEN);
