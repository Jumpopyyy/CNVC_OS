import test from 'node:test'
import assert from 'node:assert/strict'
import { recordingLeaseActive, sameRecordingUpload, speechRecoveryDelay } from '../src/contracts/dueDiligenceCollaboration.js'
import { inspectRecordingUpload } from '../../src/components/dueDiligence/recordingUploadManifest.js'
import { hasWorkspaceDraft, type InterviewWorkspaceDraft } from '../../src/components/dueDiligence/interviewWorkspaceDraft.js'
import { registerSummaryCancellation, abortSummaryRequest } from '../src/services/dueDiligenceSummaryCancellation.js'

test('expired recorder no longer prevents another employee from recording; live lease is protected',()=>{
  const now=Date.parse('2026-10-25T00:00:00Z')
  assert.equal(recordingLeaseActive({status:'paused',leaseExpiresAt:new Date(now+1)},now),true)
  assert.equal(recordingLeaseActive({status:'recording',leaseExpiresAt:new Date(now)},now),false)
  assert.equal(recordingLeaseActive({status:'archived',leaseExpiresAt:new Date(now+60000)},now),false)
  assert.equal(recordingLeaseActive(null,now),false)
})
test('permission denial never loops; recoverable recognition errors have a bounded backoff',()=>{
  for(const error of ['not-allowed','service-not-allowed','audio-capture'])assert.equal(speechRecoveryDelay(error,0),null)
  assert.deepEqual([0,1,2,3].map(attempt=>speechRecoveryDelay('network',attempt)),[2000,5000,10000,null])
})
test('resuming upload verifies the entire file, including an altered last chunk',async()=>{
  const original=await inspectRecordingUpload(new File(['abcdefghijkl'],'recording.wav'),4)
  const renamed=await inspectRecordingUpload(new File(['abcdefghijkl'],'renamed.wav'),4)
  const changed=await inspectRecordingUpload(new File(['abcdefghijkX'],'recording.wav'),4)
  assert.equal(sameRecordingUpload(original.manifest,renamed.manifest),true)
  assert.equal(sameRecordingUpload(original.manifest,changed.manifest),false)
  assert.equal(original.hashes.length,3)
})
test('upload file checking is cancellable without reading the rest of the file',async()=>{
  const controller=new AbortController();let blocks=0
  await assert.rejects(()=>inspectRecordingUpload(new File(['abcdefghijkl'],'x.wav'),4,controller.signal,()=>{blocks++;controller.abort()}),{name:'AbortError'})
  assert.equal(blocks,1)
})
const empty:InterviewWorkspaceDraft={scope:'employee/project/interview',updatedAt:'2026-10-25',promptText:'',promptQuestionId:'',promptResponses:{}}
test('minutes edits, unsent questions and response drafts are all recoverable, saved history is clean',()=>{
  assert.equal(hasWorkspaceDraft(empty),false)
  assert.equal(hasWorkspaceDraft({...empty,promptText:'补充核查'}),true)
  assert.equal(hasWorkspaceDraft({...empty,promptResponses:{question:'尚待凭证核实'}}),true)
  const summary={taskId:'task',sourceVersion:1,base:'原纪要',text:'人工修订',decisions:{}}
  assert.equal(hasWorkspaceDraft({...empty,summary}),true)
  assert.equal(hasWorkspaceDraft({...empty,summary:{...summary,text:'原纪要'}}),false)
})
test('stopping one summary cancels its request without cancelling a different interview',()=>{
  const first=registerSummaryCancellation('first'),second=registerSummaryCancellation('second')
  abortSummaryRequest('first');assert.equal(first.signal.aborted,true);assert.equal(second.signal.aborted,false)
  first.release();second.release();abortSummaryRequest('second');assert.equal(second.signal.aborted,false)
})

test('late stop of an earlier attempt never cancels a restarted summary',()=>{
  const previous=registerSummaryCancellation('same-task','old-run')
  const current=registerSummaryCancellation('same-task','new-run')
  abortSummaryRequest('same-task','old-run')
  assert.equal(current.signal.aborted,false)
  previous.release()
  abortSummaryRequest('same-task','new-run')
  assert.equal(current.signal.aborted,true)
  current.release()
})
