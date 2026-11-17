import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageFlags, PermissionFlagsBits as P } from 'discord.js';
import { openStore } from '../src/store.js';
import { createInteractionHandler } from '../src/interactions.js';
import { commands } from '../src/commands.js';

function suite() {
  const store = openStore(':memory:', () => 0), published = [], logs = [];
  store.configure('g', 'helper', 'role', 'channel'); store.question('g', 'helper', 'Why do you want to help?');
  const roles = new Map([['reviewer-1', new Set(['role'])], ['reviewer-2', new Set(['role'])]]);
  let failDelivery = false;
  const guild = { id: 'g', members: { fetch: async user => ({ id: user,
    permissions: { has: flag => user === 'manager' && flag === P.ManageGuild },
    roles: { cache: { has: role => roles.get(user)?.has(role) || false } },
  }) } };
  const handle = createInteractionHandler({ store,
    publish: async (g, id) => { if (failDelivery) throw Error('private delivery error'); published.push(store.get(g.id, id)); },
    log: data => logs.push(data),
  });
  const call = async ({ user = 'applicant', command, kind = 'chat', customId, values = {}, inputs = {}, inGuild = true } = {}) => {
    const i = { guild, guildId: 'g', user: { id: user }, commandName: command, customId,
      inGuild: () => inGuild, isChatInputCommand: () => kind === 'chat', isButton: () => kind === 'button', isModalSubmit: () => kind === 'modal',
      options: Object.fromEntries(['String', 'Integer', 'Boolean', 'Role', 'Channel'].map(type => [`get${type}`, (name, required = false) => {
        if (required && !(name in values)) throw Error(`Missing test option ${name}`); return values[name] ?? null;
      }])),
      fields: { fields: new Map(Object.entries(inputs).map(([customId, value]) => [customId, { customId, value }])), getTextInputValue: key => inputs[key] },
      deferReply: async options => { i.deferred = true; i.deferOptions = options; },
      editReply: async output => { i.output = output; i.replied = true; },
      reply: async output => { i.output = output; i.replied = true; },
      showModal: async modal => { i.modal = modal.toJSON(); i.replied = true; },
    };
    await handle(i); return i;
  };
  const submit = async user => {
    const form = await call({ user, kind: 'button', customId: 'apply:helper' });
    const submitted = await call({ user, kind: 'modal', customId: form.modal.custom_id, inputs: { q0: 'My original answer' } });
    assert.match(submitted.output, /submitted/); return store.history('g', user)[0].id;
  };
  return { store, roles, published, logs, call, submit, failDelivery: value => { failDelivery = value; } };
}

test('real interaction handler drives submit → claim → follow-up → answer → decision', async () => {
  const f = suite();
  try {
    const id = await f.submit('applicant');
    const claimed = await f.call({ user: 'reviewer-1', kind: 'button', customId: `claim:${id}` });
    assert.equal(claimed.deferOptions.flags, MessageFlags.Ephemeral); assert.match(claimed.output, /claimed/);
    await f.call({ user: 'reviewer-1', command: 'app-followup', values: { id, question: 'When are you available?' } });
    const history = await f.call({ command: 'app-history' }); assert.match(JSON.stringify(history.output.embeds[0].toJSON()), /Awaiting your reply/);
    const conversation = await f.call({ command: 'app-followups', values: { id } });
    assert.match(conversation.output.embeds[0].toJSON().fields[0].value, /When are you available/);
    const button = conversation.output.components[0].toJSON().components[0].custom_id;
    const response = await f.call({ kind: 'button', customId: button }); assert.match(response.modal.custom_id, /^followup-answer:/);
    const answered = await f.call({ kind: 'modal', customId: response.modal.custom_id, inputs: { answer: 'Evenings' } });
    assert.match(answered.output, /answer saved/);
    const reviewed = await f.call({ user: 'reviewer-1', kind: 'button', customId: `review:accepted:${id}` });
    assert.match(reviewed.output, /accepted/); assert.equal(f.store.get('g', id).status, 'accepted');
    assert.deepEqual(f.store.audit('g', id).events.map(e => e.event).reverse(), ['submitted', 'claimed', 'followup_requested', 'followup_answered', 'accepted']);
    assert.deepEqual(f.logs, []); assert.equal(f.published.at(-1).status, 'accepted');
  } finally { f.store.close(); }
});

test('claim conflicts and manager releases are enforced through command handlers', async () => {
  const f = suite();
  try {
    const id = await f.submit('applicant');
    await f.call({ user: 'reviewer-1', command: 'app-claim', values: { id } });
    const stolen = await f.call({ user: 'reviewer-2', command: 'app-review', values: { id, decision: 'denied' } });
    assert.match(stolen.output, /owns this claim/); assert.equal(f.store.get('g', id).status, 'pending');
    const denied = await f.call({ user: 'reviewer-2', command: 'app-unclaim', values: { id } });
    assert.match(denied.output, /Only the claimant/);
    const released = await f.call({ user: 'manager', command: 'app-unclaim', values: { id } });
    assert.match(released.output, /released/);
    const reviewed = await f.call({ user: 'reviewer-2', command: 'app-review', values: { id, decision: 'denied' } });
    assert.match(reviewed.output, /denied/); assert.equal(f.store.get('g', id).claimed_by, 'reviewer-2');
  } finally { f.store.close(); }
});

test('permissions are fetched at interaction time and audit trails stay staff-only', async () => {
  const f = suite();
  try {
    const id = await f.submit('applicant');
    const privateAudit = await f.call({ command: 'app-audit', values: { id } }); assert.match(privateAudit.output, /access denied/);
    const privateRead = await f.call({ user: 'outsider', command: 'app-followups', values: { id } }); assert.match(privateRead.output, /access denied/);
    f.roles.get('reviewer-1').clear();
    const revoked = await f.call({ user: 'reviewer-1', kind: 'button', customId: `claim:${id}` }); assert.match(revoked.output, /access denied/);
    assert.equal(f.store.get('g', id).claimed_by, null);
    const audit = await f.call({ user: 'reviewer-2', command: 'app-audit', values: { id } });
    assert.match(audit.output.embeds[0].toJSON().description, /submitted/);
  } finally { f.store.close(); }
});

test('managers cannot claim or decide their own applications', async () => {
  const f = suite();
  try {
    const id = await f.submit('manager');
    const claimed = await f.call({ user: 'manager', command: 'app-claim', values: { id } });
    assert.match(claimed.output, /cannot handle your own/);
    const reviewed = await f.call({ user: 'manager', command: 'app-review', values: { id, decision: 'accepted' } });
    assert.match(reviewed.output, /cannot handle your own/); assert.equal(f.store.get('g', id).status, 'pending');
  } finally { f.store.close(); }
});

test('response forms bind to one request and cannot answer a replacement', async () => {
  const f = suite();
  try {
    const id = await f.submit('applicant');
    await f.call({ user: 'reviewer-1', command: 'app-claim', values: { id } });
    await f.call({ user: 'reviewer-1', command: 'app-followup', values: { id, question: 'First question' } });
    const first = f.store.get('g', id).followups[0];
    const form = await f.call({ command: 'app-respond', values: { id } });
    await f.call({ user: 'reviewer-1', command: 'app-followup-cancel', values: { id } });
    await f.call({ user: 'reviewer-1', command: 'app-followup', values: { id, question: 'New question' } });
    const oldButton = await f.call({ kind: 'button', customId: `respond:${id}:${first.id}` });
    assert.match(oldButton.output.content, /outdated/); assert.equal(oldButton.output.flags, MessageFlags.Ephemeral);
    const stale = await f.call({ kind: 'modal', customId: form.modal.custom_id, inputs: { answer: 'Wrong question' } });
    assert.match(stale.output, /cancelled/); assert.equal(f.store.get('g', id).followups[1].answer, null);
  } finally { f.store.close(); }
});

test('withdrawal invalidates late decisions and replies through the interaction handler', async () => {
  const f = suite();
  try {
    const id = await f.submit('applicant');
    await f.call({ user: 'reviewer-1', command: 'app-claim', values: { id } });
    await f.call({ user: 'reviewer-1', command: 'app-followup', values: { id, question: 'Question' } });
    const form = await f.call({ command: 'app-respond', values: { id } });
    await f.call({ command: 'app-withdraw', values: { id } });
    const late = await f.call({ kind: 'modal', customId: form.modal.custom_id, inputs: { answer: 'Too late' } }); assert.match(late.output, /no longer pending/);
    const decision = await f.call({ user: 'reviewer-1', kind: 'button', customId: `review:accepted:${id}` }); assert.match(decision.output, /no longer pending/);
    assert.equal(f.store.get('g', id).status, 'withdrawn');
  } finally { f.store.close(); }
});

test('delivery failures preserve application data and allow staff to retry', async () => {
  const f = suite();
  try {
    f.failDelivery(true); const id = await f.submit('applicant');
    assert.equal(f.store.get('g', id).status, 'pending'); assert.equal(f.logs.length, 1);
    assert.ok(!JSON.stringify(f.logs).includes('private delivery error'));
    const outsider = await f.call({ command: 'app-post', values: { id } }); assert.match(outsider.output, /access denied/);
    f.failDelivery(false);
    const retry = await f.call({ user: 'reviewer-1', command: 'app-post', values: { id } }); assert.match(retry.output, /refreshed/);
    assert.equal(f.published.at(-1).id, id);
  } finally { f.store.close(); }
});

test('cooldown configuration requires Manage Server and blocks the applicant’s next form', async () => {
  const f = suite();
  try {
    const denied = await f.call({ user: 'reviewer-1', command: 'app-cooldown', values: { name: 'helper', minutes: 60 } }); assert.match(denied.output, /Manage Server/);
    const saved = await f.call({ user: 'manager', command: 'app-cooldown', values: { name: 'helper', minutes: 60 } }); assert.equal(saved.output, 'Saved.');
    const id = await f.submit('applicant'); await f.call({ command: 'app-withdraw', values: { id } });
    const next = await f.call({ kind: 'button', customId: 'apply:helper' });
    assert.match(next.output.content, /cooldown/); assert.equal(next.output.flags, MessageFlags.Ephemeral);
  } finally { f.store.close(); }
});

test('new command definitions serialize with bounded options', () => {
  for (const c of commands) assert.ok(c.toJSON().name);
  const cooldown = commands.find(c => c.name === 'app-cooldown').toJSON();
  const minutes = cooldown.options.find(o => o.name === 'minutes');
  assert.equal(minutes.min_value, 0); assert.equal(minutes.max_value, 43200);
  assert.equal(commands.find(c => c.name === 'app-followup').toJSON().options.find(o => o.name === 'question').max_length, 300);
});

test('unrelated interactions and DMs do not trigger application handling', async () => {
  const f = suite();
  try {
    assert.equal((await f.call({ command: 'not-this-bot' })).replied, undefined);
    assert.equal((await f.call({ kind: 'button', customId: 'other:1' })).replied, undefined);
    assert.equal((await f.call({ command: 'app-history', inGuild: false })).replied, undefined);
    assert.deepEqual(f.logs, []);
  } finally { f.store.close(); }
});
