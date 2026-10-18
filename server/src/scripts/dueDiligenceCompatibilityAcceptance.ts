import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Server } from 'node:http'
import mysql, { type RowDataPacket } from 'mysql2/promise'
import express from 'express'
import { eq } from 'drizzle-orm'
import { assertIsolatedMysqlAcceptanceDatabase } from './mysqlAcceptanceSafety.js'
import { cleanupFdeTables, withAcceptanceCleanup } from './fdeAcceptanceCleanup.js'
import type { AuthedRequest } from '../middleware/requireAuth.js'

assertIsolatedMysqlAcceptanceDatabase('dueDiligenceCompatibilityAcceptance')
const sourcePrefix = process.env.DB_FREFIX!
const targetPrefix = `fde_accept_${randomBytes(5).toString('hex')}_`
process.env.DB_FREFIX = targetPrefix
const folder = fileURLToPath(new URL('../../drizzle', import.meta.url))
const legacy = await mkdtemp(path.join(tmpdir(), 'cnvc-legacy135-'))
const { mysqlConfig, mysqlTableName, quoteMysqlIdentifier } = await import('../db/config.js')
const connect = () => mysql.createConnection({ host:mysqlConfig.host, port:mysqlConfig.port, user:mysqlConfig.user, password:mysqlConfig.password, database:mysqlConfig.database, charset:'utf8mb4_0900_ai_ci' })
const { db, pool } = await import('../db/client.js')
const { applySchemaMigrations, assertSchemaReady } = await import('../db/migrate.js')
const { checkDueDiligenceSchema } = await import('../services/dueDiligenceSchemaReadinessService.js')
async function names(connection: mysql.Connection, prefix: string) {
  const [rows] = await connection.execute<RowDataPacket[]>('SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND LEFT(TABLE_NAME,?)=? ORDER BY TABLE_NAME', [mysqlConfig.database,prefix.length,prefix])
  return rows.map(row=>String(row.name))
}
const metadata = await connect()
const sourceTables = await names(metadata, sourcePrefix)
await metadata.end()
const cleanup = () => cleanupFdeTables({ sourcePrefix,targetPrefix,sourceTables,connect:async()=>{
  const connection=await connect()
  return { tables:(prefix:string)=>names(connection,prefix), foreignKeys:async(enabled:boolean)=>{await connection.query(`SET FOREIGN_KEY_CHECKS=${enabled?1:0}`)},drop:async(table:string)=>{await connection.query(`DROP TABLE IF EXISTS ${quoteMysqlIdentifier(table)}`)},close:()=>connection.end() }
}})
let server: Server | undefined
try {
  await withAcceptanceCleanup(async()=>{
    await cp(folder,legacy,{recursive:true})
    const journal=JSON.parse(await readFile(path.join(folder,'meta/_journal.json'),'utf8'))
    const historical={...journal,entries:journal.entries.filter((entry:{idx:number})=>entry.idx<=135)}
    assert.equal(historical.entries.at(-1).tag,'0135_add_project_management_access')
    await writeFile(path.join(legacy,'meta/_journal.json'),JSON.stringify(historical))
    process.env.DB_MIGRATIONS_DIR=legacy
    await applySchemaMigrations(); await assertSchemaReady()
    const connection=await connect()
    const migrationTable=quoteMysqlIdentifier(mysqlTableName('__drizzle_migrations'))
    const [before]=await connection.query<RowDataPacket[]>(`SELECT hash,created_at FROM ${migrationTable} ORDER BY created_at`)
    assert.equal(before.length,136)
    const { users,projects,projectManagementAccessPolicies,projectManagementAccessGrants }=await import('../db/schema.js')
    const owner=randomUUID(),reader=randomUUID(),projectId=randomUUID()
    await db.insert(users).values([owner,reader].map(id=>({id,email:`${id}@acceptance.invalid`,name:'合成权限验收',role:'投资经理',passwordHash:'synthetic-non-login'})))
    await db.insert(projects).values({id:projectId,name:'兼容性合成项目',owner:'合成权限验收',ownerUserId:owner,createdBy:owner,workflowModel:'fde-v1'})
    await db.insert(projectManagementAccessPolicies).values({userId:reader,mode:'custom',readScope:'all',editScope:'none'})
    await db.insert(projectManagementAccessGrants).values({userId:owner,projectId,canView:true,canEdit:true})
    process.env.DB_MIGRATIONS_DIR=folder
    await applySchemaMigrations(); await assertSchemaReady()
    assert.ok((await checkDueDiligenceSchema()).every(Boolean),'升级后尽调结构应完整')
    const [after]=await connection.query<RowDataPacket[]>(`SELECT hash,created_at FROM ${migrationTable} ORDER BY created_at`)
    assert.equal(after.length,140)
    assert.deepEqual(after.slice(0,before.length),before,'不得覆盖或伪造已执行的迁移历史')
    const [grant]=await db.select().from(projectManagementAccessGrants).where(eq(projectManagementAccessGrants.userId,owner))
    assert.equal(grant.canEdit,true,'升级不得改变原项目授权')
    const { dueDiligenceRouter }=await import('../routes/dueDiligence.js')
    const app=express(); app.use(express.json())
    app.use((req:AuthedRequest,_res,next)=>{req.user={uid:reader,name:'合成只读员工',role:'投资经理',email:'fixture@acceptance.invalid',department:'投资部'};next()})
    app.use('/dd',dueDiligenceRouter)
    app.use((error:any,_req:express.Request,res:express.Response,_next:express.NextFunction)=>res.status(error.status||500).json({code:error.code||'ERROR'}))
    server=await new Promise<Server>(resolve=>{const listening=app.listen(0,'127.0.0.1',()=>resolve(listening))})
    const address=server.address(); assert.ok(address&&typeof address!=='string')
    const base=`http://127.0.0.1:${address.port}/dd/projects/${projectId}`
    assert.equal((await fetch(`${base}/questions`)).status,200,'只读员工仍应可查看清单')
    for(const suffix of ['/questions','/question-packs/generate',`/interviews/${randomUUID()}/recording-sessions`]) {
      const response=await fetch(`${base}${suffix}`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'})
      assert.equal(response.status,403,`新旧写入路由均应保留项目编辑权限：${suffix}`)
    }
    await new Promise<void>((resolve,reject)=>server!.close(error=>error?reject(error):resolve()));server=undefined
    await connection.end()
    await cleanup()
    await applySchemaMigrations();await assertSchemaReady()
    assert.ok((await checkDueDiligenceSchema()).every(Boolean),'全新安装也应包含权限与完整尽调结构')
    console.log(JSON.stringify({ok:true,checks:['production-135-upgrade-to-139-preserves-migration-history-and-grants','read-only-project-cannot-write-new-or-existing-dd-routes','clean-install-includes-permissions-and-dd-schema'],externalModelCalls:0}))
  },async()=>{if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));await cleanup()})
}finally{await pool.end();await rm(legacy,{recursive:true,force:true})}
