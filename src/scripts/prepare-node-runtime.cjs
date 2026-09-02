'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const MIN_NODE_MAJOR = 22
const MIN_NAPI_VERSION = 10
const source = path.resolve(process.env.TOKENMONITOR_NODE_PATH?.trim() || process.execPath)
const stagingDir = path.resolve(__dirname, '../.tmp/node-runtime')

function fail(message) {
  throw new Error(`[prepare-node-runtime] ${message}`)
}

if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
  fail(`Node executable not found: ${source}`)
}

const probe = spawnSync(source, [
  '-e',
  'const Database = require("better-sqlite3"); const db = new Database(":memory:"); db.prepare("SELECT 1").get(); db.close(); process.stdout.write(JSON.stringify({node: process.versions.node, napi: process.versions.napi, platform: process.platform, arch: process.arch, electron: process.versions.electron || null}))',
], {
  encoding: 'utf8',
  cwd: path.resolve(__dirname, '..'),
  windowsHide: true,
  shell: false,
  timeout: 5000
})

if (probe.error || probe.status !== 0) {
  fail(`could not execute ${source}: ${(probe.stderr || probe.error?.message || `exit code ${probe.status}`).trim()}`)
}

let runtime
try {
  runtime = JSON.parse(probe.stdout)
} catch (error) {
  fail(`Node version probe returned invalid JSON: ${error.message}`)
}

const nodeMajor = Number(String(runtime.node).split('.')[0])
const napiVersion = Number(runtime.napi)
if (runtime.electron) fail(`TOKENMONITOR_NODE_PATH points to Electron, not Node: ${source}`)
if (!Number.isInteger(nodeMajor) || nodeMajor < MIN_NODE_MAJOR) {
  fail(`Node ${runtime.node} is unsupported; better-sqlite3@13 requires Node ${MIN_NODE_MAJOR}+`)
}
if (!Number.isInteger(napiVersion) || napiVersion < MIN_NAPI_VERSION) {
  fail(`Node ${runtime.node} exposes N-API ${runtime.napi}; better-sqlite3@13 requires N-API ${MIN_NAPI_VERSION}+`)
}
if (runtime.platform !== process.platform || runtime.arch !== process.arch) {
  fail(`runtime ${runtime.platform}/${runtime.arch} does not match the build host ${process.platform}/${process.arch}`)
}

const targetName = runtime.platform === 'win32' ? 'node.exe' : 'node'
fs.rmSync(stagingDir, { recursive: true, force: true })
fs.mkdirSync(stagingDir, { recursive: true })
const target = path.join(stagingDir, targetName)
fs.copyFileSync(source, target)
if (runtime.platform !== 'win32') fs.chmodSync(target, 0o755)
console.log(`[prepare-node-runtime] staged ${targetName} from Node ${runtime.node} (N-API ${runtime.napi})`)
