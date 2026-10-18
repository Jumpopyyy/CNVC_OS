import test from 'node:test'
import assert from 'node:assert/strict'
import { confirmedInterviewSummary, interviewOutcomeStillCurrent, interviewSummaryPatch } from '../src/contracts/dueDiligenceInterviewOutcome.js'

const interview={id:'interview',projectId:'project',summary:'受访者表示拟讨论投前估值3亿元，尚未签署协议。'}
const task={id:'task',interviewId:interview.id,projectId:interview.projectId,kind:'summary',status:'confirmed',summary:interview.summary,transcriptVersion:3}
test('only an exact human-confirmed summary task makes interview content a knowledge source',()=>{
  assert.equal(confirmedInterviewSummary(interview,[task]),task)
  for(const changed of [{...task,status:'ready'},{...task,status:'processing'},{...task,kind:'archive-summary'},{...task,summary:'受访者已签署协议。'},{...task,projectId:'other'},{...task,interviewId:'other'},{...task,transcriptVersion:null},{...task,transcriptVersion:-1}]) assert.equal(confirmedInterviewSummary(interview,[changed]),undefined)
  assert.equal(confirmedInterviewSummary(interview,[]),undefined,'访谈结束或手填确认版本不能冒充已确认纪要')
})
test('old confirmed tasks remain usable without backfilling a missing interview marker',()=>{
  const historical={...interview,summaryTranscriptVersion:null,status:'已结束'}
  assert.equal(confirmedInterviewSummary(historical,[task])?.transcriptVersion,3)
  assert.equal(historical.summaryTranscriptVersion,null)
})
test('only changed or cleared summary content removes its confirmation marker',()=>{
  assert.deepEqual(interviewSummaryPatch(interview,{}),{})
  assert.deepEqual(interviewSummaryPatch(interview,{summary:interview.summary}),{})
  assert.deepEqual(interviewSummaryPatch(interview,{summary:` ${interview.summary} `}),{})
  assert.deepEqual(interviewSummaryPatch(interview,{summary:'新草稿尚待确认'}),{summaryTranscriptVersion:null})
  assert.deepEqual(interviewSummaryPatch(interview,{summary:''}),{summaryTranscriptVersion:null})
})
test('edited, cleared, deleted or mismatched-task summaries no longer justify prior learning',()=>{
  const payload={note:interview.summary,sourceTaskId:task.id}
  assert.equal(interviewOutcomeStillCurrent(payload,interview,[task]),true)
  assert.equal(interviewOutcomeStillCurrent({note:interview.summary},interview,[task]),true,'旧事件也必须重新核验真实确认任务')
  for(const changed of [{...interview,summary:'已签署协议'},{...interview,summary:''},undefined]) assert.equal(interviewOutcomeStillCurrent(payload,changed,[task]),false)
  assert.equal(interviewOutcomeStillCurrent({...payload,sourceTaskId:'other'},interview,[task]),false)
  assert.equal(interviewOutcomeStillCurrent(payload,interview,[]),false)
})
