import test from 'node:test';
import assert from 'node:assert/strict';
import { ChannelType } from 'discord.js';
import { openStore } from '../src/store.js';
import { createPublisher } from '../src/messaging.js';

function fixture() {
  const store = openStore(':memory:', () => 0);
  store.configure('g', 'helper', 'role', 'channel'); store.question('g', 'helper', 'Question');
  const draft = store.draft('g', 'applicant', 'helper'), a = store.submit('g', 'applicant', draft.id, ['Private answer']);
  const settings = { public: false, roleView: true, botView: true, roleExists: true, failSend: false };
  const sent = [], edited = [], message = { id: 'message', edit: async payload => { edited.push(payload); } };
  let exists = false;
  const channel = { type: ChannelType.GuildText,
    permissionsFor: principal => ({ has: () => principal.id === 'g' ? settings.public : principal.id === 'role' ? settings.roleView : settings.botView }),
    messages: { fetch: async () => { if (!exists) throw Error('Missing message'); return message; } },
    send: async payload => { if (settings.failSend) throw Error('Discord unavailable'); sent.push(payload); exists = true; return message; },
  };
  const guild = { id: 'g', channels: { fetch: async () => channel },
    roles: { everyone: { id: 'g' }, fetch: async () => settings.roleExists ? { id: 'role' } : null },
    members: { fetchMe: async () => ({ id: 'bot' }) },
  };
  return { store, a, guild, channel, message, settings, sent, edited, publish: createPublisher(store) };
}

test('concurrent refreshes create one review message and persist its ID', async () => {
  const f = fixture();
  try {
    await Promise.all([f.publish(f.guild, f.a.id), f.publish(f.guild, f.a.id)]);
    assert.equal(f.sent.length, 1); assert.equal(f.edited.length, 1);
    assert.equal(f.store.get('g', f.a.id).message, 'message');
    assert.deepEqual(f.sent[0].allowedMentions, { parse: [] });
  } finally { f.store.close(); }
});

test('queued refreshes leave the message in the latest state after an in-flight edit', async () => {
  const f = fixture();
  try {
    await f.publish(f.guild, f.a.id);
    let release, entered;
    const gate = new Promise(resolve => { release = resolve; });
    const editing = new Promise(resolve => { entered = resolve; });
    let first = true;
    f.message.edit = async payload => { f.edited.push(payload); if (first) { first = false; entered(); await gate; } };
    const pendingEdit = f.publish(f.guild, f.a.id); await editing;
    f.store.withdraw('g', f.a.id, f.a.user);
    const finalEdit = f.publish(f.guild, f.a.id); release();
    await Promise.all([pendingEdit, finalEdit]);
    assert.match(f.edited.at(-1).embeds[0].toJSON().description, /Status: withdrawn/);
    assert.equal(f.edited.at(-1).components.length, 0);
  } finally { f.store.close(); }
});

test('private review-channel permissions are checked again before each delivery', async () => {
  const f = fixture();
  try {
    for (const [key, value, reset] of [['public', true, false], ['roleView', false, true], ['botView', false, true], ['roleExists', false, true]]) {
      f.settings[key] = value;
      await assert.rejects(f.publish(f.guild, f.a.id));
      assert.equal(f.sent.length, 0); assert.equal(f.store.get('g', f.a.id).message, null);
      f.settings[key] = reset;
    }
    await f.publish(f.guild, f.a.id); assert.equal(f.sent.length, 1);
  } finally { f.store.close(); }
});

test('failed delivery does not poison the queue or alter saved decisions', async () => {
  const f = fixture();
  try {
    f.store.review('g', f.a.id, 'reviewer', true, 'denied', 'Try later');
    f.settings.failSend = true; await assert.rejects(f.publish(f.guild, f.a.id));
    assert.equal(f.store.get('g', f.a.id).status, 'denied');
    assert.equal(f.store.audit('g', f.a.id).events[0].event, 'denied');
    f.settings.failSend = false; await f.publish(f.guild, f.a.id);
    assert.match(f.sent[0].embeds[0].toJSON().description, /Status: denied/);
    assert.equal(f.sent[0].components.length, 0);
  } finally { f.store.close(); }
});

test('delivered decision buttons pause for an open follow-up and resume after resolution', async () => {
  const f = fixture();
  const decisions = payload => payload.components.flatMap(row => row.toJSON().components)
    .filter(button => button.custom_id.startsWith('review:'));
  try {
    f.store.claim('g', f.a.id, 'reviewer', true);
    const request = f.store.askFollowup('g', f.a.id, 'reviewer', true, 'Availability?').followups[0];
    await f.publish(f.guild, f.a.id);
    assert.equal(decisions(f.sent[0]).length, 2);
    assert.ok(decisions(f.sent[0]).every(button => button.disabled === true));
    f.store.answerFollowup('g', request.id, f.a.user, 'Evenings');
    await f.publish(f.guild, f.a.id);
    assert.ok(decisions(f.edited.at(-1)).every(button => button.disabled === false));
    f.store.askFollowup('g', f.a.id, 'reviewer', true, 'Another question');
    await f.publish(f.guild, f.a.id);
    assert.ok(decisions(f.edited.at(-1)).every(button => button.disabled === true));
    f.store.cancelFollowup('g', f.a.id, 'reviewer', true);
    await f.publish(f.guild, f.a.id);
    assert.ok(decisions(f.edited.at(-1)).every(button => button.disabled === false));
    f.store.review('g', f.a.id, 'reviewer', true, 'accepted');
    await f.publish(f.guild, f.a.id);
    assert.equal(decisions(f.edited.at(-1)).length, 0);
  } finally { f.store.close(); }
});
