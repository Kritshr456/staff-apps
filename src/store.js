import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
export class AppError extends Error {}
export function openStore(path=':memory:',clock=()=>Date.now()){
 if(path!==':memory:')mkdirSync(dirname(path),{recursive:true,mode:0o700});
 const db=new DatabaseSync(path);
 db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
   CREATE TABLE IF NOT EXISTS templates(guild TEXT,name TEXT,role TEXT,channel TEXT,questions TEXT NOT NULL DEFAULT '[]',enabled INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(guild,name));
   CREATE TABLE IF NOT EXISTS drafts(id INTEGER PRIMARY KEY AUTOINCREMENT,guild TEXT,user TEXT,name TEXT,questions TEXT,role TEXT,channel TEXT,expires INTEGER);
   CREATE TABLE IF NOT EXISTS applications(id INTEGER PRIMARY KEY,draft INTEGER UNIQUE,guild TEXT,user TEXT,name TEXT,
     questions TEXT,answers TEXT,role TEXT,channel TEXT,message TEXT,status TEXT NOT NULL DEFAULT 'pending',
     reviewer TEXT,note TEXT,created INTEGER,reviewed INTEGER);
   CREATE UNIQUE INDEX IF NOT EXISTS pending_application ON applications(guild,user,name) WHERE status='pending';`);
 const tx=fn=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}};
 const template=(guild,name)=>{const t=db.prepare('SELECT * FROM templates WHERE guild=? AND name=?').get(guild,name);if(t)t.questions=JSON.parse(t.questions);return t;};
 const get=(guild,id)=>{const a=db.prepare('SELECT * FROM applications WHERE guild=? AND id=?').get(guild,id);if(a){a.questions=JSON.parse(a.questions);a.answers=JSON.parse(a.answers);}return a;};
 function required(guild,name){const t=template(guild,name);if(!t)throw new AppError('Template not found.');return t;}
 return {
 close:()=>db.close(),template,get,
 configure(guild,name,role,channel){
   if(!/^[a-z0-9-]{1,24}$/.test(name))throw new AppError('Use a lowercase template name with 1–24 letters, digits or hyphens.');
   db.prepare('INSERT INTO templates(guild,name,role,channel) VALUES(?,?,?,?) ON CONFLICT(guild,name) DO UPDATE SET role=excluded.role,channel=excluded.channel').run(guild,name,role,channel);
 },
 question(guild,name,prompt){
   const t=required(guild,name);
   if(typeof prompt!=='string'||!prompt.trim()||prompt.length>100)throw new AppError('Questions must contain 1–100 characters.');
   if(t.questions.length>=5)throw new AppError('A template supports up to five questions.');
   t.questions.push(prompt.trim());db.prepare('UPDATE templates SET questions=? WHERE guild=? AND name=?').run(JSON.stringify(t.questions),guild,name);
 },
 removeQuestion(guild,name,index){const t=required(guild,name);if(!Number.isInteger(index)||index<1||index>t.questions.length)throw new AppError('Question number does not exist.');t.questions.splice(index-1,1);db.prepare('UPDATE templates SET questions=? WHERE guild=? AND name=?').run(JSON.stringify(t.questions),guild,name);},
 toggle(guild,name,enabled){required(guild,name);db.prepare('UPDATE templates SET enabled=? WHERE guild=? AND name=?').run(enabled?1:0,guild,name);},
 draft(guild,user,name){
   const t=required(guild,name);
   if(!t.enabled||!t.questions.length)throw new AppError('Applications are closed or questions have not been configured.');
   if(db.prepare("SELECT 1 FROM applications WHERE guild=? AND user=? AND name=? AND status='pending'").get(guild,user,name))throw new AppError('You already have a pending application for this template.');
   db.prepare('DELETE FROM drafts WHERE expires<? OR (guild=? AND user=?)').run(clock(),guild,user);
   const id=Number(db.prepare('INSERT INTO drafts(guild,user,name,questions,role,channel,expires) VALUES(?,?,?,?,?,?,?)').run(guild,user,name,JSON.stringify(t.questions),t.role,t.channel,clock()+20*60000).lastInsertRowid);
   return {id,questions:t.questions};
 },
 submit(guild,user,id,answers){return tx(()=>{
   const d=db.prepare('SELECT * FROM drafts WHERE id=? AND guild=? AND user=?').get(id,guild,user);
   if(!d||d.expires<clock())throw new AppError('This form expired. Open a new application.');
   if(!required(guild,d.name).enabled)throw new AppError('Applications have been closed.');
   const questions=JSON.parse(d.questions);
   if(!Array.isArray(answers)||answers.length!==questions.length||answers.some(a=>typeof a!=='string'||!a.trim()||a.length>1000))throw new AppError('Every answer must contain 1–1000 characters.');
   if(db.prepare("SELECT 1 FROM applications WHERE guild=? AND user=? AND name=? AND status='pending'").get(guild,user,d.name))throw new AppError('An application is already pending.');
   const applicationId=Number(db.prepare('INSERT INTO applications(draft,guild,user,name,questions,answers,role,channel,created) VALUES(?,?,?,?,?,?,?,?,?)').run(id,guild,user,d.name,d.questions,JSON.stringify(answers.map(a=>a.trim())),d.role,d.channel,clock()).lastInsertRowid);
   db.prepare('DELETE FROM drafts WHERE id=?').run(id);return get(guild,applicationId);
 });},
 review(guild,id,reviewer,allowed,decision,note=''){
   if(!['accepted','denied'].includes(decision))throw new AppError('Decision must be accepted or denied.');
   if(typeof note!=='string'||note.length>250)throw new AppError('Notes are limited to 250 characters.');
   const a=get(guild,id);if(!a)throw new AppError('Application not found.');
   if(!allowed||a.user===reviewer)throw new AppError('Review requires staff access and you cannot review your own application.');
   const changed=db.prepare("UPDATE applications SET status=?,reviewer=?,note=?,reviewed=? WHERE guild=? AND id=? AND status='pending'").run(decision,reviewer,note,clock(),guild,id).changes;
   if(!changed)throw new AppError('This application has already been reviewed.');
   return get(guild,id);
 },
 setMessage:(guild,id,message)=>db.prepare('UPDATE applications SET message=? WHERE guild=? AND id=?').run(message,guild,id),
 history:(guild,user)=>db.prepare('SELECT id,name,status,note,created FROM applications WHERE guild=? AND user=? ORDER BY id DESC LIMIT 10').all(guild,user),
 listTemplates:guild=>db.prepare('SELECT name,enabled,questions FROM templates WHERE guild=? ORDER BY name').all(guild).map(t=>({...t,questions:JSON.parse(t.questions)})),
 };
}
