import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dispatchInput,relevantFiles} from './dispatch-distribution.ts';
test('dispatch only a merged same-repository main PR',()=>{
 const pr={number:21,merged:true,base:{ref:'main',repo:{full_name:'owner/cv'}},head:{repo:{full_name:'owner/cv'}}};
 assert.deepEqual(dispatchInput(pr,'owner/cv'),{ref:'main',inputs:{pr:'21',deliver:true}});
 assert.throws(()=>dispatchInput({...pr,merged:false},'owner/cv'));
 assert.throws(()=>dispatchInput({...pr,head:{repo:{full_name:'fork/cv'}}},'owner/cv'));
});

test('unrelated merges do not enqueue distribution',()=>{assert.equal(relevantFiles(['docs/note.md']),false);assert.equal(relevantFiles(['README.md']),true);});
