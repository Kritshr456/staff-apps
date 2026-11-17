import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openStore, AppError } from '../src/store.js';
import { reviewMessage, followupMessage, auditMessage, responseModal, historyMessage } from '../src/presentation.js';

function fixture(path = ':memory:', clock = () => 0) {
  const s = openStore(path, clock); s.configure('g', 'helper', 'role', 'channel');
  s.question('g', 'helper', 'Why do you want to help?');
  const d = s.draft('g', 'applicant', 'helper'), a = s.submit('g', 'applicant', d.id, ['I like helping.']);
  return { s, a };
}
const reject = fn => assert.throws(fn, AppError);

test('claims are exclusive; takeover requires a visible release, including for managers', () => {
  const { s, a } = fixture();
  try {
    reject(() => s.claim('g', a.id, 'outsider', false)); reject(() => s.claim('g', a.id, a.user, true));
    s.claim('g', a.id, 'r1', true);
    reject(() => s.claim('g', a.id, 'r2', true)); reject(() => s.unclaim('g', a.id, 'r2', true));
    reject(() => s.review('g', a.id, 'manager', true, 'accepted'));
    s.unclaim('g', a.id, 'manager', true, true); s.claim('g', a.id, 'r2', true);
    reject(() => s.review('g', a.id, 'r1', true, 'accepted'));
    s.review('g', a.id, 'r2', true, 'accepted');
    assert.deepEqual(s.audit('g', a.id).events.map(e => e.event).reverse(), ['submitted', 'claimed', 'unclaimed', 'claimed', 'accepted']);
    const released = s.audit('g', a.id).events.find(e => e.event === 'unclaimed');
    assert.equal(released.actor, 'manager'); assert.equal(released.details.previousClaim, 'r1');
    reject(() => s.unclaim('g', a.id, 'manager', true, true));
  } finally { s.close(); }
});

test('claims and follow-ups require current review permissions and the same guild', () => {
  const { s, a } = fixture();
  try {
    s.claim('g', a.id, 'r1', true);
    for (const allowed of [false, 'true', 1]) {
      reject(() => s.askFollowup('g', a.id, 'r1', allowed, 'Question'));
      reject(() => s.unclaim('g', a.id, 'r1', allowed));
      reject(() => s.review('g', a.id, 'r1', allowed, 'accepted'));
    }
    reject(() => s.claim('other', a.id, 'r1', true));
    reject(() => s.askFollowup('other', a.id, 'r1', true, 'Question'));
    reject(() => s.audit('other', a.id));
    assert.equal(s.audit('g', a.id).total, 2);
  } finally { s.close(); }
});

test('follow-ups require a claim, accept only one open request and validate text', () => {
  const { s, a } = fixture();
  try {
    reject(() => s.askFollowup('g', a.id, 'r1', true, 'Question'));
    s.claim('g', a.id, 'r1', true);
    for (const text of ['', ' ', 'x'.repeat(301), null]) reject(() => s.askFollowup('g', a.id, 'r1', true, text));
    const updated = s.askFollowup('g', a.id, 'r1', true, '  Tell us more.  ');
    assert.equal(updated.followups[0].question, 'Tell us more.');
    reject(() => s.askFollowup('g', a.id, 'r1', true, 'Another question'));
    reject(() => s.review('g', a.id, 'r1', true, 'accepted'));
    assert.equal(s.history('g', a.user)[0].awaiting_reply, 1);
  } finally { s.close(); }
});

test('only the applicant can answer a specific request, once', () => {
  const { s, a } = fixture();
  try {
    s.claim('g', a.id, 'r1', true);
    const f = s.askFollowup('g', a.id, 'r1', true, 'Availability?').followups[0];
    reject(() => s.responseRequest('g', a.id, 'outsider'));
    reject(() => s.answerFollowup('other', f.id, a.user, 'Answer'));
    reject(() => s.answerFollowup('g', f.id, 'r1', 'Answer'));
    for (const text of ['', ' ', 'x'.repeat(1001), null]) reject(() => s.answerFollowup('g', f.id, a.user, text));
    const answered = s.answerFollowup('g', f.id, a.user, 'Evenings');
    assert.equal(answered.followups[0].answer, 'Evenings');
    assert.equal(s.history('g', a.user)[0].awaiting_reply, 0);
    reject(() => s.answerFollowup('g', f.id, a.user, 'Changed answer'));
    s.askFollowup('g', a.id, 'r1', true, 'One more thing?');
    reject(() => s.answerFollowup('g', f.id, a.user, 'Answer for the new request'));
    assert.equal(s.responseRequest('g', a.id, a.user).question, 'One more thing?');
    s.cancelFollowup('g', a.id, 'r1', true);
    assert.equal(s.review('g', a.id, 'r1', true, 'accepted').status, 'accepted');
  } finally { s.close(); }
});

test('cancelled requests stay in history and count toward the three-request limit', () => {
  const { s, a } = fixture();
  try {
    s.claim('g', a.id, 'r1', true);
    for (let n = 0; n < 3; n++) {
      s.askFollowup('g', a.id, 'r1', true, `Question ${n}`);
      reject(() => s.cancelFollowup('g', a.id, 'r2', true));
      s.cancelFollowup('g', a.id, 'r1', true);
    }
    reject(() => s.askFollowup('g', a.id, 'r1', true, 'Fourth question'));
    reject(() => s.cancelFollowup('g', a.id, 'r1', true));
    assert.ok(s.get('g', a.id).followups.every(f => f.status === 'cancelled'));
    assert.equal(s.review('g', a.id, 'r1', true, 'denied').status, 'denied');
  } finally { s.close(); }
});

test('withdrawal cancels open requests and invalidates outstanding reply forms', () => {
  const { s, a } = fixture();
  try {
    s.claim('g', a.id, 'r1', true);
    const f = s.askFollowup('g', a.id, 'r1', true, 'Question').followups[0];
    s.withdraw('g', a.id, a.user);
    assert.equal(s.get('g', a.id).followups[0].status, 'cancelled');
    reject(() => s.answerFollowup('g', f.id, a.user, 'Late answer'));
    reject(() => s.review('g', a.id, 'r1', true, 'accepted'));
    const events = s.audit('g', a.id).events;
    assert.equal(events[0].event, 'withdrawn'); assert.equal(events[1].event, 'followup_cancelled');
    assert.equal(events[1].details.reason, 'application_withdrawn');
  } finally { s.close(); }
});

test('cooldowns apply after acceptance, denial and withdrawal, with exact expiry', () => {
  for (const action of ['accepted', 'denied', 'withdrawn']) {
    let now = 1000; const { s, a } = fixture(':memory:', () => now);
    try {
      s.setCooldown('g', 'helper', 1);
      if (action === 'withdrawn') s.withdraw('g', a.id, a.user);
      else s.review('g', a.id, 'r1', true, action);
      assert.equal(s.get('g', a.id).cooldown_until, 61000);
      s.setCooldown('g', 'helper', 0);
      now = 60999; assert.throws(() => s.draft('g', a.user, 'helper'), /cooldown/);
      now = 61000; assert.ok(s.draft('g', a.user, 'helper'));
    } finally { s.close(); }
  }
});

test('cooldowns are scoped to guild, user and template, and new settings preserve existing deadlines', () => {
  const { s, a } = fixture();
  try {
    s.setCooldown('g', 'helper', 60); s.review('g', a.id, 'r1', true, 'denied');
    s.configure('g', 'helper', 'new-role', 'new-channel');
    assert.equal(s.template('g', 'helper').cooldown_minutes, 60);
    assert.ok(s.draft('g', 'someone-else', 'helper'));
    s.configure('other', 'helper', 'role', 'channel'); s.question('other', 'helper', 'Question');
    assert.ok(s.draft('other', a.user, 'helper'));
    s.configure('g', 'another', 'role', 'channel'); s.question('g', 'another', 'Question');
    assert.ok(s.draft('g', a.user, 'another'));
    for (const value of [-1, 43201, 1.5, '60', true]) reject(() => s.setCooldown('g', 'helper', value));
    assert.equal(s.get('g', a.id).cooldown_until, 3600000);
  } finally { s.close(); }
});

test('audit pagination keeps deterministic order without copying application answers', () => {
  const { s, a } = fixture();
  try {
    for (let n = 0; n < 7; n++) { s.claim('g', a.id, 'r1', true); s.unclaim('g', a.id, 'r1', true); }
    const first = s.audit('g', a.id), second = s.audit('g', a.id, 2);
    assert.equal(first.total, 15); assert.equal(first.events.length, 10); assert.equal(second.events.length, 5);
    assert.ok(first.events.at(-1).id > second.events[0].id);
    assert.ok(!JSON.stringify([...first.events, ...second.events]).includes('I like helping.'));
    assert.deepEqual(s.audit('g', a.id, 3).events, []);
    reject(() => s.audit('g', a.id, 0));
  } finally { s.close(); }
});

test('maximum-size originals and follow-up conversations stay inside Discord limits', () => {
  const { s, a } = fixture();
  try {
    s.claim('g', a.id, 'r1', true);
    for (let n = 0; n < 3; n++) {
      const f = s.askFollowup('g', a.id, 'r1', true, 'q'.repeat(300)).followups.at(-1);
      s.answerFollowup('g', f.id, a.user, 'a'.repeat(1000));
    }
    const full = { ...s.review('g', a.id, 'r1', true, 'accepted', 'n'.repeat(250)),
      id: Number.MAX_SAFE_INTEGER, name: 'x'.repeat(24), user: '1'.repeat(20), claimed_by: '2'.repeat(20), reviewer: '2'.repeat(20),
      questions: Array(5).fill('q'.repeat(100)), answers: Array(5).fill('a'.repeat(1000)) };
    for (const payload of [reviewMessage(full), followupMessage(full), auditMessage(a.id, s.audit('g', a.id))]) {
      assert.ok(payload.embeds[0].length <= 6000); assert.ok(payload.embeds[0].toJSON());
      for (const field of payload.embeds[0].toJSON().fields || []) assert.ok(field.value.length <= 1024);
      for (const row of payload.components || []) assert.ok(row.toJSON());
    }
    assert.ok(responseModal({ id: 1, question: 'q'.repeat(300) }).toJSON());
    assert.ok(!reviewMessage(full).components[0].toJSON().components.some(c => c.custom_id.startsWith('review:')));
  } finally { s.close(); }
});

test('failed final writes roll back automatic claiming and audit insertion', () => {
  const directory = mkdtempSync(join(tmpdir(), 'staff-apps-rollback-')), path = join(directory, 'app.sqlite');
  const { s, a } = fixture(path);
  try {
    const db = new DatabaseSync(path);
    db.exec("CREATE TRIGGER reject_decision BEFORE UPDATE OF status ON applications WHEN NEW.status='accepted' BEGIN SELECT RAISE(ABORT,'simulated write failure'); END;"); db.close();
    assert.throws(() => s.review('g', a.id, 'r1', true, 'accepted'));
    assert.equal(s.get('g', a.id).claimed_by, null); assert.equal(s.get('g', a.id).status, 'pending');
    assert.deepEqual(s.audit('g', a.id).events.map(e => e.event), ['submitted']);
  } finally { s.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('legacy databases migrate in place without invented audit events or lost drafts', () => {
  const directory = mkdtempSync(join(tmpdir(), 'staff-apps-migration-')), path = join(directory, 'app.sqlite');
  try {
    const db = new DatabaseSync(path);
    db.exec(`
      CREATE TABLE templates(guild TEXT,name TEXT,role TEXT,channel TEXT,questions TEXT NOT NULL DEFAULT '[]',enabled INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(guild,name));
      CREATE TABLE drafts(id INTEGER PRIMARY KEY AUTOINCREMENT,guild TEXT,user TEXT,name TEXT,questions TEXT,role TEXT,channel TEXT,expires INTEGER);
      CREATE TABLE applications(id INTEGER PRIMARY KEY,draft INTEGER UNIQUE,guild TEXT,user TEXT,name TEXT,questions TEXT,answers TEXT,role TEXT,channel TEXT,message TEXT,status TEXT NOT NULL DEFAULT 'pending',reviewer TEXT,note TEXT,created INTEGER,reviewed INTEGER);
      INSERT INTO templates VALUES('g','helper','role','channel','["Question"]',1);
      INSERT INTO drafts VALUES(42,'g','new-user','helper','["Question"]','role','channel',1200000);
      INSERT INTO applications VALUES(1,1,'g','pending-user','helper','["Question"]','["Original answer"]','role','channel','message-1','pending',NULL,NULL,0,NULL),
        (2,2,'g','accepted-user','helper','["Question"]','["Saved answer"]','role','channel','message-2','accepted','staff','Original note',0,500);
    `); db.close();
    let s = openStore(path, () => 1000);
    assert.equal(s.template('g', 'helper').cooldown_minutes, 0);
    assert.equal(s.get('g', 1).message, 'message-1'); assert.deepEqual(s.get('g', 1).answers, ['Original answer']);
    assert.equal(s.get('g', 2).status, 'accepted'); assert.equal(s.get('g', 2).note, 'Original note');
    assert.equal(s.audit('g', 1).total, 0); assert.equal(s.audit('g', 2).total, 0);
    assert.ok(s.submit('g', 'new-user', 42, ['Still valid']));
    s.claim('g', 1, 'r1', true); const f = s.askFollowup('g', 1, 'r1', true, 'Additional question').followups[0];
    s.close(); s = openStore(path, () => 1000);
    assert.equal(s.get('g', 1).claimed_by, 'r1'); assert.equal(s.get('g', 1).followups[0].id, f.id);
    assert.equal(s.audit('g', 1).total, 2); s.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('future database versions are refused without removing data', () => {
  const directory = mkdtempSync(join(tmpdir(), 'staff-apps-future-')), path = join(directory, 'app.sqlite');
  try {
    let db = new DatabaseSync(path); db.exec("CREATE TABLE sentinel(value TEXT); INSERT INTO sentinel VALUES('keep'); PRAGMA user_version=2;"); db.close();
    assert.throws(() => openStore(path), /newer/);
    db = new DatabaseSync(path); assert.equal(db.prepare('SELECT value FROM sentinel').get().value, 'keep'); db.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('all ten history records fit Discord limits with full notes and cooldowns', () => {
  const rows = Array.from({ length: 10 }, (_, n) => ({ id: Number.MAX_SAFE_INTEGER - n,
    name: 'x'.repeat(24), status: 'pending', created: 0, note: 'n'.repeat(250),
    cooldown_until: 3600000, awaiting_reply: 1 }));
  const payload = historyMessage(rows);
  assert.equal(payload.embeds[0].toJSON().fields.length, 10);
  assert.ok(payload.embeds[0].length <= 6000);
  assert.ok(historyMessage([]).embeds[0].toJSON());
});
