import test from 'node:test';
import assert from 'node:assert/strict';
import {Publisher} from '../src/publisher.mjs';
test('scoped content is rejected before any public publisher request',async()=>{const p=new Publisher({execution:{publicPublishing:true}},{reader:{},fetchImpl:()=>assert.fail('private bytes must not reach a public gateway')});for(const dataPolicy of ['scoped','confidential','restricted'])await assert.rejects(()=>p.publish('private content',{dataPolicy}),/SCOPED_CONTENT_REQUIRES_ENCRYPTED_HANDOFF/);await assert.rejects(()=>p.publish('private content',{acceptance:{dataPolicy:'scoped'}}),/SCOPED_CONTENT_REQUIRES_ENCRYPTED_HANDOFF/);});
