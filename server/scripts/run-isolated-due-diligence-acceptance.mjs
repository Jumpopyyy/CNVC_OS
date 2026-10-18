// Disposable local MySQL only. Never reads .env or connects to a business database.
import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const docker = process.env.DD_TEST_DOCKER || 'docker'
const suite = process.env.DD_TEST_SUITE || 'full'
if (!['full', 'compatibility'].includes(suite)) throw new Error('Unsupported isolated acceptance suite')
const entry = suite === 'compatibility' ? 'dueDiligenceCompatibilityAcceptance.ts' : 'dueDiligenceReleaseAcceptance.ts'
const name = `cnvc-dd-acceptance-${randomBytes(6).toString('hex')}`
const password = randomBytes(24).toString('hex')
const directory = await mkdtemp(path.join(tmpdir(), 'cnvc-dd-acceptance-'))
let created = false
const runDocker = args => {
  const result = spawnSync(docker, args, {encoding:'utf8'})
  if(result.status !== 0) throw new Error(`Isolated Docker command failed: ${args[0]} ${String(result.stderr || '').slice(0,300)}`)
  return result.stdout.trim()
}
try {
  runDocker(['run','--detach','--pull=never','--name',name,'--memory=768m','--cpus=1','-p','127.0.0.1::3306',
    '-e',`MYSQL_ROOT_PASSWORD=${password}`,'-e','MYSQL_DATABASE=cnvc_acceptance_test','mysql:8.0',
    '--innodb-buffer-pool-size=64M','--max-connections=24','--character-set-server=utf8mb4','--collation-server=utf8mb4_0900_ai_ci'])
  created = true
  const port = runDocker(['port',name,'3306/tcp']).split(':').at(-1)
  const mysql = await import('mysql2/promise')
  let connection
  for(let attempt=0;attempt<60;attempt++) {
    try { connection=await mysql.createConnection({host:'127.0.0.1',port:Number(port),user:'root',password,database:'cnvc_acceptance_test',connectTimeout:1000});break }
    catch { await new Promise(resolve=>setTimeout(resolve,1000)) }
  }
  if(!connection) throw new Error('Isolated MySQL did not become ready')
  await connection.end()
  const env = {
    PATH:process.env.PATH, HOME:process.env.HOME, TMPDIR:process.env.TMPDIR, NODE_ENV:'test',
    DB_HOST:'127.0.0.1',DB_PORT:port,DB_DATABASE:'cnvc_acceptance_test',DB_USERNAME:'root',DB_PASSWORD:password,DB_FREFIX:'sbl_',DB_POOL_SIZE:'4',
    ALLOW_MYSQL_ACCEPTANCE_WRITES:'1',PROJECT_FILE_ROOT:directory,
    ...(process.env.DD_TEST_ARTIFACT_DIR ? {DD_TEST_ARTIFACT_DIR:process.env.DD_TEST_ARTIFACT_DIR}:{}),
  }
  console.log(JSON.stringify({isolated:true,container:name,businessDatabaseAccess:false}))
  const exitCode = await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['--import','tsx',`server/src/scripts/${entry}`],{env,stdio:'inherit'})
    child.once('error',reject);child.once('exit',code=>resolve(code ?? 1))
  })
  process.exitCode = exitCode
} finally {
  if(created) runDocker(['rm','--force','--volumes',name])
  await rm(directory,{recursive:true,force:true})
  console.log(JSON.stringify({isolatedContainerRemoved:created,temporaryRecordingStorageRemoved:true}))
}
