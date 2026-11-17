import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../src/store.js';
import { commands } from '../src/commands.js';
import { reviewMessage } from '../src/presentation.js';
function fixture(clock){const s=openStore(':memory:',clock);s.configure('g','helper','role','channel');s.question('g','helper','Why do you want to help?');return s;}
test('draft questions and routing remain stable when template changes',()=>{
 const s=fixture();try{const d=s.draft('g','user','helper');s.configure('g','helper','new-role','new-channel');s.question('g','helper','New question');const a=s.submit('g','user',d.id,['I like helping.']);assert.equal(a.questions.length,1);assert.equal(a.role,'role');assert.equal(a.channel,'channel');assert.equal(s.get('other',a.id),undefined);}finally{s.close();}
});
test('draft identity, expiry and closed templates are enforced',()=>{
 let now=0;const s=fixture(()=>now);try{let d=s.draft('g','user','helper');assert.throws(()=>s.submit('g','other',d.id,['answer']));now=21*60000;assert.throws(()=>s.submit('g','user',d.id,['answer']));d=s.draft('g','user','helper');s.toggle('g','helper',false);assert.throws(()=>s.submit('g','user',d.id,['answer']));assert.throws(()=>s.draft('g','user','helper'));}finally{s.close();}
});
test('answers validate and pending submissions cannot be duplicated',()=>{
 const s=fixture();try{const d=s.draft('g','user','helper');assert.throws(()=>s.submit('g','user',d.id,[' ']));assert.throws(()=>s.submit('g','user',d.id,[]));s.submit('g','user',d.id,['answer']);assert.throws(()=>s.submit('g','user',d.id,['answer']));assert.throws(()=>s.draft('g','user','helper'));}finally{s.close();}
});
test('review checks staff, blocks self-review, and only resolves once',()=>{
 const s=fixture();try{const d=s.draft('g','user','helper'),a=s.submit('g','user',d.id,['answer']);assert.throws(()=>s.review('g',a.id,'user',true,'accepted'));assert.throws(()=>s.review('g',a.id,'outsider',false,'accepted'));s.review('g',a.id,'staff',true,'denied','Try again later.');assert.throws(()=>s.review('g',a.id,'staff2',true,'accepted'));assert.equal(s.history('g','user')[0].note,'Try again later.');const next=s.draft('g','user','helper');assert.notEqual(next.id,d.id);assert.ok(s.submit('g','user',next.id,['A new answer']));}finally{s.close();}
});
test('question count and remove validation',()=>{const s=fixture();try{for(let n=0;n<4;n++)s.question('g','helper',`Question ${n}`);assert.throws(()=>s.question('g','helper','too many'));assert.throws(()=>s.removeQuestion('g','helper',6));s.removeQuestion('g','helper',2);assert.equal(s.template('g','helper').questions.length,4);}finally{s.close();}});
test('commands and maximum-size review messages serialize within Discord limits',()=>{
 for(const c of commands)assert.ok(c.toJSON().name);
 const a={id:1,name:'x'.repeat(24),user:'user',status:'accepted',reviewer:'staff',note:'x'.repeat(250),questions:Array(5).fill('q'.repeat(100)),answers:Array(5).fill('a'.repeat(1000)),created:0};
 const payload=reviewMessage(a);assert.equal(payload.components.length,0);const embed=payload.embeds[0];assert.ok(embed.length<=6000);assert.ok(embed.toJSON());
});
test('only the applicant can withdraw, preserving history and allowing reapplication',()=>{
 const s=fixture();try{
  const d=s.draft('g','user','helper'),a=s.submit('g','user',d.id,['original answer']);
  assert.throws(()=>s.withdraw('g',a.id,'someone-else'));
  assert.throws(()=>s.withdraw('other',a.id,'user'));
  const withdrawn=s.withdraw('g',a.id,'user');
  assert.equal(withdrawn.status,'withdrawn');assert.deepEqual(withdrawn.answers,['original answer']);
  assert.equal(s.history('g','user')[0].status,'withdrawn');
  assert.equal(reviewMessage(withdrawn).components.length,0);
  assert.throws(()=>s.review('g',a.id,'staff',true,'accepted'));
  assert.throws(()=>s.withdraw('g',a.id,'user'));
  const next=s.draft('g','user','helper');assert.ok(s.submit('g','user',next.id,['new answer']));
 }finally{s.close();}
});
test('reviewed applications cannot be withdrawn or have their decisions changed',()=>{
 const s=fixture();try{
  const d=s.draft('g','user','helper'),a=s.submit('g','user',d.id,['answer']);
  s.review('g',a.id,'staff',true,'accepted','Welcome');
  assert.throws(()=>s.withdraw('g',a.id,'user'));
  assert.equal(s.get('g',a.id).status,'accepted');assert.equal(s.get('g',a.id).note,'Welcome');
 }finally{s.close();}
});
