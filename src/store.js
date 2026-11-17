import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { migrate } from './migrations.js';

export class AppError extends Error {}
function boundedText(value, limit, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > limit)
    throw new AppError(`${label} must contain 1–${limit} characters.`);
  return value.trim();
}
export function openStore(path = ':memory:', clock = () => Date.now()) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  try { db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;'); migrate(db); }
  catch (error) { db.close(); throw error; }
  const tx = fn => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  const template = (guild, name) => {
    const t = db.prepare('SELECT * FROM templates WHERE guild=? AND name=?').get(guild, name);
    if (t) t.questions = JSON.parse(t.questions);
    return t;
  };
  const required = (guild, name) => {
    const t = template(guild, name); if (!t) throw new AppError('Template not found.'); return t;
  };
  const get = (guild, id) => {
    const a = db.prepare('SELECT * FROM applications WHERE guild=? AND id=?').get(guild, id);
    if (a) {
      a.questions = JSON.parse(a.questions); a.answers = JSON.parse(a.answers);
      a.followups = db.prepare('SELECT * FROM followups WHERE application=? ORDER BY id').all(a.id);
    }
    return a;
  };
  const application = (guild, id) => {
    const a = get(guild, id); if (!a) throw new AppError('Application not found.'); return a;
  };
  const pending = a => { if (a.status !== 'pending') throw new AppError('This application is no longer pending.'); };
  const reviewer = (a, actor, allowed) => {
    if (allowed !== true || a.user === actor)
      throw new AppError('Review requires staff access and you cannot handle your own application.');
    pending(a);
  };
  const ownsClaim = (a, actor) => {
    if (a.claimed_by !== actor) throw new AppError('Claim this application first. Another reviewer’s claim must be released before taking over.');
  };
  const audit = (id, actor, event, details = {}) => db.prepare('INSERT INTO audit(application,actor,event,details,created) VALUES(?,?,?,?,?)')
    .run(id, actor, event, JSON.stringify(details), clock());
  const cooldownEnd = a => {
    const minutes = required(a.guild, a.name).cooldown_minutes;
    return minutes ? clock() + minutes * 60000 : 0;
  };
  const checkEligibility = (guild, user, name) => {
    const t = required(guild, name);
    if (!t.enabled || !t.questions.length) throw new AppError('Applications are closed or questions have not been configured.');
    if (db.prepare("SELECT 1 FROM applications WHERE guild=? AND user=? AND name=? AND status='pending'").get(guild, user, name))
      throw new AppError('You already have a pending application for this template.');
    const until = db.prepare('SELECT MAX(cooldown_until) AS until FROM applications WHERE guild=? AND user=? AND name=?').get(guild, user, name).until;
    if (until && until > clock()) throw new AppError(`Reapplication cooldown: try again after ${new Date(until).toISOString()}.`);
    return t;
  };
  const claim = (a, actor) => {
    const changed = db.prepare("UPDATE applications SET claimed_by=?,claimed_at=? WHERE id=? AND status='pending' AND claimed_by IS NULL")
      .run(actor, clock(), a.id).changes;
    if (!changed) throw new AppError('This application is already claimed or has been resolved.');
    audit(a.id, actor, 'claimed');
  };
  const cancelOpenFollowup = (a, actor, reason) => {
    const open = a.followups.find(f => f.status === 'open');
    if (!open) return false;
    db.prepare("UPDATE followups SET status='cancelled',cancelled=?,cancelled_by=? WHERE id=? AND status='open'").run(clock(), actor, open.id);
    audit(a.id, actor, 'followup_cancelled', { followupId: open.id, reason });
    return true;
  };
  return {
    close: () => db.close(), template, get,
    configure(guild, name, role, channel) {
      if (!/^[a-z0-9-]{1,24}$/.test(name)) throw new AppError('Use a lowercase template name with 1–24 letters, digits or hyphens.');
      db.prepare('INSERT INTO templates(guild,name,role,channel) VALUES(?,?,?,?) ON CONFLICT(guild,name) DO UPDATE SET role=excluded.role,channel=excluded.channel')
        .run(guild, name, role, channel);
    },
    setCooldown(guild, name, minutes) {
      required(guild, name);
      if (!Number.isInteger(minutes) || minutes < 0 || minutes > 43200) throw new AppError('Cooldown must be 0–43200 minutes.');
      db.prepare('UPDATE templates SET cooldown_minutes=? WHERE guild=? AND name=?').run(minutes, guild, name);
    },
    question(guild, name, prompt) {
      const t = required(guild, name); prompt = boundedText(prompt, 100, 'Questions');
      if (t.questions.length >= 5) throw new AppError('A template supports up to five questions.');
      t.questions.push(prompt);
      db.prepare('UPDATE templates SET questions=? WHERE guild=? AND name=?').run(JSON.stringify(t.questions), guild, name);
    },
    removeQuestion(guild, name, index) {
      const t = required(guild, name);
      if (!Number.isInteger(index) || index < 1 || index > t.questions.length) throw new AppError('Question number does not exist.');
      t.questions.splice(index - 1, 1);
      db.prepare('UPDATE templates SET questions=? WHERE guild=? AND name=?').run(JSON.stringify(t.questions), guild, name);
    },
    toggle(guild, name, enabled) {
      required(guild, name); db.prepare('UPDATE templates SET enabled=? WHERE guild=? AND name=?').run(enabled ? 1 : 0, guild, name);
    },
    draft(guild, user, name) {
      return tx(() => {
        const t = checkEligibility(guild, user, name);
        db.prepare('DELETE FROM drafts WHERE expires<=? OR (guild=? AND user=?)').run(clock(), guild, user);
        const id = Number(db.prepare('INSERT INTO drafts(guild,user,name,questions,role,channel,expires) VALUES(?,?,?,?,?,?,?)')
          .run(guild, user, name, JSON.stringify(t.questions), t.role, t.channel, clock() + 20 * 60000).lastInsertRowid);
        return { id, questions: t.questions };
      });
    },
    submit(guild, user, id, answers) {
      return tx(() => {
        const d = db.prepare('SELECT * FROM drafts WHERE id=? AND guild=? AND user=?').get(id, guild, user);
        if (!d || d.expires <= clock()) throw new AppError('This form expired. Open a new application.');
        checkEligibility(guild, user, d.name);
        const questions = JSON.parse(d.questions);
        if (!Array.isArray(answers) || answers.length !== questions.length ||
          answers.some(a => typeof a !== 'string' || !a.trim() || a.length > 1000))
          throw new AppError('Every answer must contain 1–1000 characters.');
        const applicationId = Number(db.prepare('INSERT INTO applications(draft,guild,user,name,questions,answers,role,channel,created) VALUES(?,?,?,?,?,?,?,?,?)')
          .run(id, guild, user, d.name, d.questions, JSON.stringify(answers.map(a => a.trim())), d.role, d.channel, clock()).lastInsertRowid);
        db.prepare('DELETE FROM drafts WHERE id=?').run(id);
        audit(applicationId, user, 'submitted');
        return get(guild, applicationId);
      });
    },
    claim(guild, id, actor, allowed) {
      return tx(() => { const a = application(guild, id); reviewer(a, actor, allowed); claim(a, actor); return get(guild, id); });
    },
    unclaim(guild, id, actor, allowed, isManager = false) {
      return tx(() => {
        const a = application(guild, id); reviewer(a, actor, allowed);
        if (!a.claimed_by || (a.claimed_by !== actor && isManager !== true))
          throw new AppError('Only the claimant or a server manager can release a claim.');
        db.prepare("UPDATE applications SET claimed_by=NULL,claimed_at=NULL WHERE id=? AND status='pending'").run(a.id);
        audit(a.id, actor, 'unclaimed', { previousClaim: a.claimed_by });
        return get(guild, id);
      });
    },
    askFollowup(guild, id, actor, allowed, question) {
      question = boundedText(question, 300, 'Follow-up questions');
      return tx(() => {
        const a = application(guild, id); reviewer(a, actor, allowed); ownsClaim(a, actor);
        if (a.followups.some(f => f.status === 'open')) throw new AppError('A follow-up is already awaiting an answer.');
        if (a.followups.length >= 3) throw new AppError('An application supports up to three follow-up requests, including cancelled requests.');
        const followupId = Number(db.prepare('INSERT INTO followups(application,question,asked_by,asked) VALUES(?,?,?,?)')
          .run(a.id, question, actor, clock()).lastInsertRowid);
        audit(a.id, actor, 'followup_requested', { followupId });
        return get(guild, id);
      });
    },
    responseRequest(guild, id, user) {
      const a = application(guild, id);
      if (a.user !== user) throw new AppError('Only the applicant can respond to follow-ups.');
      pending(a);
      const open = a.followups.find(f => f.status === 'open');
      if (!open) throw new AppError('There is no follow-up awaiting your answer.');
      return open;
    },
    answerFollowup(guild, followupId, user, answer) {
      answer = boundedText(answer, 1000, 'Follow-up answers');
      return tx(() => {
        const f = db.prepare('SELECT f.* FROM followups f JOIN applications a ON a.id=f.application WHERE f.id=? AND a.guild=?').get(followupId, guild);
        if (!f) throw new AppError('Follow-up not found.');
        const a = application(guild, f.application);
        if (a.user !== user) throw new AppError('Only the applicant can respond to follow-ups.');
        pending(a);
        if (f.status !== 'open') throw new AppError('This follow-up has already been answered or cancelled.');
        db.prepare("UPDATE followups SET answer=?,answered=?,status='answered' WHERE id=? AND status='open'").run(answer, clock(), f.id);
        audit(a.id, user, 'followup_answered', { followupId: f.id });
        return get(guild, a.id);
      });
    },
    cancelFollowup(guild, id, actor, allowed) {
      return tx(() => {
        const a = application(guild, id); reviewer(a, actor, allowed); ownsClaim(a, actor);
        if (!cancelOpenFollowup(a, actor, 'reviewer_cancelled')) throw new AppError('There is no open follow-up to cancel.');
        return get(guild, id);
      });
    },
    withdraw(guild, id, user) {
      return tx(() => {
        const a = application(guild, id);
        if (a.user !== user || a.status !== 'pending') throw new AppError('Only your own pending application can be withdrawn.');
        const until = cooldownEnd(a);
        db.prepare("UPDATE applications SET status='withdrawn',reviewed=?,cooldown_until=? WHERE id=? AND status='pending'").run(clock(), until, a.id);
        cancelOpenFollowup(a, user, 'application_withdrawn');
        audit(a.id, user, 'withdrawn', { cooldownUntil: until });
        return get(guild, id);
      });
    },
    review(guild, id, actor, allowed, decision, note = '') {
      if (!['accepted', 'denied'].includes(decision)) throw new AppError('Decision must be accepted or denied.');
      if (typeof note !== 'string' || note.length > 250) throw new AppError('Notes are limited to 250 characters.');
      return tx(() => {
        const a = application(guild, id); reviewer(a, actor, allowed);
        if (a.followups.some(f => f.status === 'open')) throw new AppError('Answer or cancel the open follow-up before making a final decision.');
        if (a.claimed_by && a.claimed_by !== actor) throw new AppError('Another reviewer owns this claim. Release it before taking over.');
        if (!a.claimed_by) claim(a, actor);
        const until = cooldownEnd(a);
        db.prepare("UPDATE applications SET status=?,reviewer=?,note=?,reviewed=?,cooldown_until=? WHERE id=? AND status='pending'")
          .run(decision, actor, note.trim(), clock(), until, a.id);
        audit(a.id, actor, decision, { cooldownUntil: until });
        return get(guild, id);
      });
    },
    audit(guild, id, page = 1) {
      const a = application(guild, id);
      if (!Number.isInteger(page) || page < 1 || page > 100000) throw new AppError('Invalid audit page.');
      const total = db.prepare('SELECT COUNT(*) AS total FROM audit WHERE application=?').get(a.id).total;
      const events = db.prepare('SELECT * FROM audit WHERE application=? ORDER BY id DESC LIMIT 10 OFFSET ?').all(a.id, (page - 1) * 10)
        .map(e => ({ ...e, details: JSON.parse(e.details) }));
      return { page, total, events };
    },
    setMessage: (guild, id, message) => db.prepare('UPDATE applications SET message=? WHERE guild=? AND id=?').run(message, guild, id),
    history: (guild, user) => db.prepare(`SELECT a.id,a.name,a.status,a.note,a.created,a.cooldown_until,
      EXISTS(SELECT 1 FROM followups f WHERE f.application=a.id AND f.status='open') AS awaiting_reply
      FROM applications a WHERE a.guild=? AND a.user=? ORDER BY a.id DESC LIMIT 10`).all(guild, user),
    listTemplates: guild => db.prepare('SELECT name,enabled,questions,cooldown_minutes FROM templates WHERE guild=? ORDER BY name').all(guild)
      .map(t => ({ ...t, questions: JSON.parse(t.questions) })),
  };
}
