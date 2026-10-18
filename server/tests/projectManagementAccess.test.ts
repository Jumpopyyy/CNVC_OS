import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import {
  ProjectManagementAccessSchema,
  projectManagementAccessDecision,
} from '../src/contracts/projectManagementAccessContract.js'

const actorId = '11111111-1111-4111-8111-111111111111'
const ownProject = {
  id: '22222222-2222-4222-8222-222222222222',
  ownerUserId: actorId, createdBy: '33333333-3333-4333-8333-333333333333', memberUserIds: [],
}
const otherProject = {
  id: '44444444-4444-4444-8444-444444444444',
  ownerUserId: '55555555-5555-4555-8555-555555555555', createdBy: null, memberUserIds: [],
}

test('unconfigured access inherits existing project rules', () => {
  assert.equal(projectManagementAccessDecision(null, actorId, otherProject, 'read'), null)
  assert.equal(projectManagementAccessDecision(null, actorId, otherProject, 'edit'), null)
})

test('own scope includes owners, creators, and project members', () => {
  const policy = { readScope: 'own' as const, editScope: 'own' as const, grants: [] }
  assert.equal(projectManagementAccessDecision(policy, actorId, ownProject, 'edit'), true)
  assert.equal(projectManagementAccessDecision(policy, actorId, { ...otherProject, createdBy: actorId }, 'read'), true)
  assert.equal(projectManagementAccessDecision(policy, actorId, { ...otherProject, memberUserIds: [actorId] }, 'edit'), true)
  assert.equal(projectManagementAccessDecision(policy, actorId, otherProject, 'read'), false)
})

test('all read, own edit, and one explicit edit grant are distinct', () => {
  const policy = {
    readScope: 'all' as const,
    editScope: 'own' as const,
    grants: [{ projectId: otherProject.id, canView: true, canEdit: true }],
  }
  assert.equal(projectManagementAccessDecision(policy, actorId, otherProject, 'read'), true)
  assert.equal(projectManagementAccessDecision(policy, actorId, otherProject, 'edit'), true)
  assert.equal(projectManagementAccessDecision({ ...policy, grants: [] }, actorId, otherProject, 'edit'), false)
})

test('an explicit edit grant also allows viewing that project', () => {
  const policy = { readScope: 'none' as const, editScope: 'none' as const, grants: [{ projectId: otherProject.id, canView: true, canEdit: true }] }
  assert.equal(projectManagementAccessDecision(policy, actorId, otherProject, 'read'), true)
  assert.equal(projectManagementAccessDecision(policy, actorId, otherProject, 'edit'), true)
  assert.equal(projectManagementAccessDecision(policy, actorId, ownProject, 'read'), false)
})

test('policy input rejects contradictory and duplicate grants', () => {
  assert.equal(ProjectManagementAccessSchema.safeParse({ readScope: 'none', editScope: 'all', grants: [] }).success, false)
  assert.equal(ProjectManagementAccessSchema.safeParse({ readScope: 'none', editScope: 'none', grants: [{ projectId: otherProject.id, canView: false, canEdit: true }] }).success, false)
  assert.equal(ProjectManagementAccessSchema.safeParse({ readScope: 'none', editScope: 'none', grants: [
    { projectId: otherProject.id, canView: true, canEdit: false },
    { projectId: otherProject.id, canView: true, canEdit: false },
  ] }).success, false)
})

test('project queries apply configured read and edit policy in SQL', async () => {
  const defaults = {
    DB_HOST: '127.0.0.1', DB_PORT: '3306', DB_DATABASE: 'contract_test',
    DB_USERNAME: 'contract_test', DB_PASSWORD: 'contract_test', DB_FREFIX: 'contract_',
  }
  for (const [key, value] of Object.entries(defaults)) process.env[key] ||= value
  const [{ db }, { projects }, { projectAccessCondition, projectEditCondition }] = await Promise.all([
    import('../src/db/client.js'), import('../src/db/schema.js'), import('../src/services/projectAccessService.js'),
  ])
  const actor = { uid: actorId, name: '测试用户', role: '员工' }
  const read = db.select({ id: projects.id }).from(projects).where(projectAccessCondition(actor)).toSQL().sql
  const edit = db.select({ id: projects.id }).from(projects).where(projectEditCondition(actor)).toSQL().sql
  assert.match(read, /project_management_access_policies/)
  assert.match(read, /project_management_access_grants/)
  assert.match(read, /pa\.mode='custom'/)
  assert.match(read, /pa\.read_scope/)
  assert.match(read, /pg\.can_view/)
  assert.match(edit, /pa\.edit_scope/)
  assert.match(edit, /pg\.can_edit/)
})

test('project edit middleware leaves file routes to their file-specific checks', async () => {
  const source = ts.createSourceFile('projects.ts', readFileSync(new URL('../src/routes/projects.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
  const statement = source.statements.find((node) => ts.isExpressionStatement(node)
    && ts.isCallExpression(node.expression)
    && node.expression.expression.getText(source) === 'projectsRouter.use'
    && node.expression.arguments[0]?.getText(source) === "'/:id'")
  assert.ok(statement && ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression))
  const handlerSource = statement.expression.arguments[1].getText(source)
  const handler = runInNewContext(ts.transpileModule(`const handler = ${handlerSource}; handler`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    requireEditableProject: async () => { throw new Error('must not check files as a project') },
  }) as (req: unknown, res: unknown, next: (error?: unknown) => void) => Promise<void>
  let result: unknown = 'not called'
  await handler({ method: 'POST', params: { id: 'files' }, user: { uid: actorId } }, {}, (error) => { result = error })
  assert.equal(result, undefined)
})

test('inherit mode keeps a policy row and advances its version', () => {
  const source = readFileSync(new URL('../src/services/projectManagementAccessService.ts', import.meta.url), 'utf8')
  assert.match(source, /mode: 'inherit', readScope: 'none', editScope: 'none',[\s\S]*version: current\.version \+ 1/)
  assert.doesNotMatch(source, /delete\(projectManagementAccessPolicies\)/)
})

test('linked meeting and todo writes require project edit access', () => {
  const source = readFileSync(new URL('../src/routes/meetings.ts', import.meta.url), 'utf8')
  assert.match(source, /async function requireEditableLinkedMeeting[\s\S]*requireEditableProject\(req\.user!\.uid, meeting\.projectId\)/)
  assert.match(source, /meetingsRouter\.post\('\/',[\s\S]*requireEditableProject\(req\.user!\.uid, projectId\)/)
  assert.match(source, /meetingsRouter\.patch\('\/:id',[\s\S]*requireEditableProject\(req\.user!\.uid, existing\.projectId\)/)
  for (const action of ['contributions', 'lifecycle', 'finalize']) {
    assert.match(source, new RegExp(`meetingsRouter\\.post\\('\\/:id\\/${action}',[\\s\\S]*?requireEditableLinkedMeeting`))
  }
  assert.match(source, /meetingsRouter\.delete\('\/:id',[\s\S]*?requireEditableLinkedMeeting/)
  assert.match(source, /todosRouter\.post\('\/',[\s\S]*?requireEditableProject\(req\.user!\.uid, body\.projectId\)/)
  assert.match(source, /todosRouter\.patch\('\/:id',[\s\S]*?requireEditableProject\(req\.user!\.uid, existing\.projectId\)/)
  assert.match(source, /todosRouter\.delete\('\/:id',[\s\S]*?requireEditableProject\(req\.user!\.uid, existing\.projectId\)/)
})

test('lead conversion requires permission to create a project', () => {
  const source = readFileSync(new URL('../src/routes/meta.ts', import.meta.url), 'utf8')
  assert.match(source, /metaRouter\.post\('\/leads\/:id\/convert',[\s\S]*?requireProjectCreationAccess\(req\.user!\.uid\)[\s\S]*?convertLead\(/)
})
