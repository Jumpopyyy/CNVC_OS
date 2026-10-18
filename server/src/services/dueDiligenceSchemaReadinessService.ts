import { db } from '../db/client.js'
import { digitalTwinBuildSessions, digitalTwinInquiries, digitalTwinProjectKnowledge } from '../db/schema.js'
import { digitalTwins, digitalTwinPrivateAssets, digitalTwinSkillImports, digitalTwinSkillVersions, digitalTwinPublications, digitalTwinLearningCandidates, digitalTwinVersions, digitalTwinDialogueSessions, digitalTwinRuntimeCalls, dueDiligenceTranscriptionJobs, dueDiligenceRecordingSessions, dueDiligenceRecordingChunks, dueDiligenceArtifactTasks, dueDiligenceQuestions, dueDiligenceQuestionEvidence, dueDiligenceQuestionPacks } from '../db/schema.js'

export const DUE_DILIGENCE_SCHEMA_VERSION = '0139_digital_twin_builder_and_knowledge'

/** Probe actual columns, not just the migration journal. No DDL or data writes. */
export async function checkDueDiligenceSchema() {
  return Promise.all([
    db.select({ id: dueDiligenceTranscriptionJobs.id }).from(dueDiligenceTranscriptionJobs).limit(1),
    db.select({ request: digitalTwins.clientRequestId, target: digitalTwins.learningTargetAt, avatar: digitalTwins.avatarKind }).from(digitalTwins).limit(1),
    db.select({ id: digitalTwinPrivateAssets.id }).from(digitalTwinPrivateAssets).limit(1),
    db.select({ id: digitalTwinSkillImports.id }).from(digitalTwinSkillImports).limit(1),
    db.select({ epochs: dueDiligenceRecordingSessions.epochs, lease: dueDiligenceRecordingSessions.archiveLeaseExpiresAt }).from(dueDiligenceRecordingSessions).limit(1),
    db.select({ hash: dueDiligenceRecordingChunks.sha256 }).from(dueDiligenceRecordingChunks).limit(1),
    db.select({ merge: dueDiligenceArtifactTasks.mergeState, version: dueDiligenceArtifactTasks.transcriptVersion }).from(dueDiligenceArtifactTasks).limit(1),
    db.select({ keys: dueDiligenceQuestions.generationKeys, deleted: dueDiligenceQuestions.deletedAt }).from(dueDiligenceQuestions).limit(1),
    db.select({ version: dueDiligenceQuestionEvidence.fileVersion, excerpt: dueDiligenceQuestionEvidence.excerpt }).from(dueDiligenceQuestionEvidence).limit(1),
    db.select({ snapshot: dueDiligenceQuestionPacks.skillSnapshot }).from(dueDiligenceQuestionPacks).limit(1),
    db.select({ boundaries: digitalTwinPublications.publicBoundaries, confirmed: digitalTwinPublications.publicContentConfirmedAt }).from(digitalTwinPublications).limit(1),
    db.select({ refs: digitalTwinLearningCandidates.sourceRefs, conflict: digitalTwinLearningCandidates.conflictNote }).from(digitalTwinLearningCandidates).limit(1),
    db.select({ refs: digitalTwinSkillVersions.sourceRefs, scopes: digitalTwinSkillVersions.taskScopes }).from(digitalTwinSkillVersions).limit(1),
    db.select({ snapshot: digitalTwinVersions.skillSnapshot }).from(digitalTwinVersions).limit(1),
    db.select({ scope: digitalTwinDialogueSessions.scopeKey }).from(digitalTwinDialogueSessions).limit(1),
    db.select({ snapshot: digitalTwinRuntimeCalls.snapshot }).from(digitalTwinRuntimeCalls).limit(1),
    db.select({ description: digitalTwins.description, mode: digitalTwins.descriptionMode }).from(digitalTwins).limit(1),
    db.select({ id: digitalTwinBuildSessions.id }).from(digitalTwinBuildSessions).limit(1),
    db.select({ id: digitalTwinInquiries.id }).from(digitalTwinInquiries).limit(1),
    db.select({ id: digitalTwinProjectKnowledge.id }).from(digitalTwinProjectKnowledge).limit(1),
  ].map(query => query.then(() => true).catch(() => false)))
}
