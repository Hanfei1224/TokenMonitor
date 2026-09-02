'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const test = require('node:test')
const Database = require('better-sqlite3')

const workerPath = path.join(__dirname, 'sqlite-worker.cjs')

function runWorker(payload) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [workerPath], {
      cwd: __dirname,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.once('error', reject)
    child.once('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `worker exited with ${code}`))
        return
      }
      try {
        resolve(JSON.parse(stdout))
      } catch (err) {
        reject(err)
      }
    })
    child.stdin.end(JSON.stringify(payload))
  })
}

function localDate(ts) {
  const date = new Date(ts)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function tempDatabase() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenmonitor-stats-'))
  return {
    dir,
    path: path.join(dir, 'stats.db'),
    close() {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }
}

test('aggregates OpenCode messages in the worker', async () => {
  const fixture = tempDatabase()
  const firstTs = Date.UTC(2026, 0, 2, 12, 0, 0)
  const secondTs = firstTs + 60 * 60 * 1000
  const nextDayTs = firstTs + 24 * 60 * 60 * 1000

  try {
    const db = new Database(fixture.path)
    try {
      db.exec('CREATE TABLE message (session_id TEXT, time_created INTEGER, data TEXT)')
      const insert = db.prepare('INSERT INTO message VALUES (?, ?, ?)')
      insert.run('s1', firstTs, JSON.stringify({ role: 'assistant', modelID: 'model-a', tokens: { total: 10, input: 2, output: 3, reasoning: 1, cache: { read: 2, write: 1 } } }))
      insert.run('s1', secondTs, JSON.stringify({ role: 'assistant', modelID: 'model-a', tokens: { total: 5, input: 1, output: 2, reasoning: 0, cache: { read: 1, write: 1 } } }))
      insert.run('s2', nextDayTs, JSON.stringify({ role: 'assistant', modelID: 'model-b', tokens: { total: 4, input: 3, output: 1 } }))
      insert.run('s2', nextDayTs, JSON.stringify({ role: 'user', modelID: 'model-b', tokens: { total: 100 } }))
    } finally {
      db.close()
    }

    const result = await runWorker({ kind: 'opencode', dbPaths: [fixture.path], startMs: firstTs - 1 })
    assert.equal(result.maxTs, nextDayTs)
    assert.equal('rows' in result, false)
    assert.equal(result.aggregates.length, 2)
    assert.deepEqual(result.aggregates.find((row) => row.model === 'model-a'), {
      date: localDate(firstTs),
      model: 'model-a',
      total: 15,
      input: 3,
      output: 6,
      cache_read: 3,
      cache_write: 2,
      requests: 2,
      max_ts: secondTs
    })
  } finally {
    fixture.close()
  }
})

test('aggregates ZCode usage with the existing token split', async () => {
  const fixture = tempDatabase()
  const firstTs = Date.UTC(2026, 0, 3, 12, 0, 0)

  try {
    const db = new Database(fixture.path)
    try {
      db.exec(`CREATE TABLE model_usage (
        started_at INTEGER,
        status TEXT,
        input_tokens INTEGER,
        output_tokens INTEGER,
        cache_creation_input_tokens INTEGER,
        cache_read_input_tokens INTEGER,
        computed_total_tokens INTEGER,
        agent TEXT,
        provider_id TEXT,
        model_id TEXT
      )`)
      const insert = db.prepare('INSERT INTO model_usage VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      insert.run(firstTs, 'completed', 10, 2, 1, 3, 16, 'agent', 'provider', 'model-z')
      insert.run(firstTs, 'completed', 5, 1, 0, 0, 6, null, 'provider', null)
      insert.run(firstTs, 'running', 100, 100, 0, 0, 200, null, null, 'ignored')
    } finally {
      db.close()
    }

    const result = await runWorker({ kind: 'zcode', dbPath: fixture.path, startMs: firstTs - 1 })
    assert.equal(result.maxTs, firstTs)
    assert.deepEqual(result.aggregates, [
      {
        date: localDate(firstTs),
        model: 'model-z',
        total: 16,
        input: 6,
        output: 2,
        cache_read: 3,
        cache_write: 1,
        requests: 1,
        max_ts: firstTs
      },
      {
        date: localDate(firstTs),
        model: 'provider',
        total: 6,
        input: 5,
        output: 1,
        cache_read: 0,
        cache_write: 0,
        requests: 1,
        max_ts: firstTs
      }
    ])
  } finally {
    fixture.close()
  }
})
