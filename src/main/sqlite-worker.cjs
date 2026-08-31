'use strict'

// Must run under system Node, never Electron. better-sqlite3 13 segfaults
// inside Electron 34 (Node 20 / V8 sandbox).
if (process.versions.electron) {
  process.stderr.write('sqlite-worker must run under Node, not Electron\n')
  process.exit(2)
}

const fs = require('fs')
const Database = require('better-sqlite3')

let raw = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  raw += chunk
})
process.stdin.on('end', () => {
  try {
    const payload = JSON.parse(raw || '{}')
    const dbPath = payload.dbPath
    const sql = payload.sql
    const params = Array.isArray(payload.params) ? payload.params : []
    if (!dbPath || !sql || !fs.existsSync(dbPath)) {
      process.stdout.write('[]')
      process.exit(0)
    }
    const db = new Database(dbPath, { readonly: true, fileMustExist: true, timeout: 5000 })
    try {
      const rows = db.prepare(sql).all(...params)
      process.stdout.write(JSON.stringify(rows))
    } finally {
      db.close()
    }
  } catch (err) {
    process.stderr.write(err && err.stack ? err.stack : String(err))
    process.exit(1)
  }
})
