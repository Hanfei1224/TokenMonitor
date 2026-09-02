import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { scanJsonlRoot } from './statsScanner.ts'

function parseLine(line) {
  const value = JSON.parse(line)
  return {
    ts: value.ts,
    total: value.total,
    input: value.input || 0,
    output: value.output || 0,
    cache_read: value.cache_read || 0,
    cache_write: value.cache_write || 0,
    model: value.model || 'fixture'
  }
}

function totalFor(states) {
  return Object.values(states).reduce((sum, state) => {
    return sum + Object.values(state.days).reduce((daySum, day) => daySum + day.total, 0)
  }, 0)
}

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenmonitor-jsonl-'))
  return {
    root,
    file: path.join(root, 'session.jsonl'),
    close() {
      fs.rmSync(root, { recursive: true, force: true })
    }
  }
}

test('reconciles append and rewritten JSONL files without duplicates', async () => {
  const fixture = tempRoot()
  const ts = Date.now()

  try {
    fs.writeFileSync(fixture.file, `${JSON.stringify({ ts, total: 10 })}\n`)
    const first = await scanJsonlRoot(fixture.root, 'codex', {}, parseLine)
    assert.equal(first.complete, true)
    assert.equal(totalFor(first.states), 10)

    fs.appendFileSync(fixture.file, `${JSON.stringify({ ts: ts + 1, total: 20 })}\n`)
    const appended = await scanJsonlRoot(fixture.root, 'codex', first.states, parseLine)
    assert.equal(appended.complete, true)
    assert.equal(totalFor(appended.states), 30)

    fs.writeFileSync(fixture.file, `${JSON.stringify({ ts, total: 11 })}\n${JSON.stringify({ ts: ts + 1, total: 20 })}\n`)
    const rewritten = await scanJsonlRoot(fixture.root, 'codex', appended.states, parseLine)
    assert.equal(rewritten.complete, true)
    assert.equal(totalFor(rewritten.states), 31)

    const repeated = await scanJsonlRoot(fixture.root, 'codex', rewritten.states, parseLine)
    assert.equal(repeated.complete, true)
    assert.equal(totalFor(repeated.states), 31)
  } finally {
    fixture.close()
  }
})

test('retries a partial final line after the writer completes it', async () => {
  const fixture = tempRoot()
  const ts = Date.now()

  try {
    fs.writeFileSync(fixture.file, `${JSON.stringify({ ts, total: 10 })}\n{"ts":${ts + 1},"total":20`)
    const partial = await scanJsonlRoot(fixture.root, 'codex', {}, parseLine)
    assert.equal(totalFor(partial.states), 10)

    fs.appendFileSync(fixture.file, '}\n')
    const completed = await scanJsonlRoot(fixture.root, 'codex', partial.states, parseLine)
    assert.equal(completed.complete, true)
    assert.equal(totalFor(completed.states), 30)
  } finally {
    fixture.close()
  }
})
