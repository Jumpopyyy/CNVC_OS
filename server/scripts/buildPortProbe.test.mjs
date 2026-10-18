import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {EventEmitter} from 'node:events'
import test from 'node:test'

const source = await readFile(new URL('./build-platform.mjs',import.meta.url),'utf8')
const start = source.indexOf('function portOpen(port) {')
const end = source.indexOf('\nasync function acquireLock()',start)
assert.ok(start>=0 && end>start)
const createProbe = new Function('net',`${source.slice(start,end)}; return portOpen;`)
for(const [event,code,occupied] of [['connect',null,true],['timeout',null,true],['error','EPERM',true],['error','EACCES',true],['error','ECONNREFUSED',false]]) {
  test(`build activation fails closed for ${event}/${code || ''}`,async()=>{
    const probe = createProbe({createConnection(){const socket=new EventEmitter();socket.setTimeout=()=>{};socket.destroy=()=>{};queueMicrotask(()=>socket.emit(event,{code}));return socket}})
    assert.equal(await probe(4100),occupied)
  })
}
