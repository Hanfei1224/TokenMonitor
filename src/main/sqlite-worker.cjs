'use strict'

// Must run under an independent Node runtime, never Electron. better-sqlite3
// 13 is not safe inside Electron 34 (Node 20 / V8 sandbox).
if (process.versions.electron) {
  process.stderr.write('sqlite-worker must run under Node, not Electron\n')
  process.exit(2)
}

if (Number(process.versions.node.split('.')[0]) < 22) {
  process.stderr.write(`sqlite-worker requires Node 22+, got ${process.versions.node}\n`)
  process.exit(2)
}

const fs = require('fs')
const Database = require('better-sqlite3')

const OPENCODE_SQL = `
  WITH source_rows AS (
    SELECT
      time_created AS ts,
      CAST(COALESCE(json_extract(data, '$.tokens.total'), 0) AS REAL) AS reported_total,
      CAST(COALESCE(json_extract(data, '$.tokens.input'), 0) AS REAL) AS input,
      CAST(COALESCE(json_extract(data, '$.tokens.output'), 0) AS REAL) AS output,
      CAST(COALESCE(json_extract(data, '$.tokens.reasoning'), 0) AS REAL) AS reasoning,
      CAST(COALESCE(json_extract(data, '$.tokens.cache.read'), 0) AS REAL) AS cache_read,
      CAST(COALESCE(json_extract(data, '$.tokens.cache.write'), 0) AS REAL) AS cache_write,
      COALESCE(
        NULLIF(CAST(json_extract(data, '$.modelID') AS TEXT), ''),
        NULLIF(CAST(json_extract(data, '$.providerID') AS TEXT), ''),
        'opencode'
      ) AS model
    FROM message
    WHERE json_extract(data, '$.role') = 'assistant' AND time_created > ?
  )
  SELECT
    strftime('%Y-%m-%d', ts / 1000, 'unixepoch', 'localtime') AS date,
    model,
    SUM(CASE
      WHEN reported_total > input + output + reasoning + cache_read + cache_write
      THEN reported_total
      ELSE input + output + reasoning + cache_read + cache_write
    END) AS total,
    SUM(input) AS input,
    SUM(output + reasoning) AS output,
    SUM(cache_read) AS cache_read,
    SUM(cache_write) AS cache_write,
    COUNT(*) AS requests,
    MAX(ts) AS max_ts
  FROM source_rows
  GROUP BY date, model
  ORDER BY date, model
`

const ZCODE_SQL = `
  WITH source_rows AS (
    SELECT
      started_at AS ts,
      CAST(COALESCE(input_tokens, 0) AS REAL) AS raw_input,
      CAST(COALESCE(output_tokens, 0) AS REAL) AS output,
      CAST(COALESCE(cache_creation_input_tokens, 0) AS REAL) AS cache_write,
      CAST(COALESCE(cache_read_input_tokens, 0) AS REAL) AS cache_read,
      CAST(COALESCE(computed_total_tokens, 0) AS REAL) AS total,
      CASE
        WHEN model_id IS NOT NULL AND model_id != '' THEN CAST(model_id AS TEXT)
        WHEN provider_id IS NOT NULL AND provider_id != '' THEN CAST(provider_id AS TEXT)
        ELSE 'zcode'
      END AS model
    FROM model_usage
    WHERE status = 'completed'
      AND computed_total_tokens > 0
      AND started_at > ?
  )
  SELECT
    strftime('%Y-%m-%d', ts / 1000, 'unixepoch', 'localtime') AS date,
    model,
    SUM(total) AS total,
    SUM(MAX(0, raw_input - cache_read - cache_write)) AS input,
    SUM(output) AS output,
    SUM(cache_read) AS cache_read,
    SUM(cache_write) AS cache_write,
    COUNT(*) AS requests,
    MAX(ts) AS max_ts
  FROM source_rows
  GROUP BY date, model
  ORDER BY date, model
`

function emptyResult(maxTs) {
  return { maxTs, aggregates: [] }
}

function existingPath(paths) {
  return paths.find((value) => typeof value === 'string' && fs.existsSync(value)) || null
}

function queryAggregate(db, sql, startMs) {
  const aggregates = db.prepare(sql).all(startMs)
  let maxTs = startMs
  for (const aggregate of aggregates) {
    if (Number.isFinite(Number(aggregate.max_ts))) {
      maxTs = Math.max(maxTs, Number(aggregate.max_ts))
    }
  }
  return { maxTs, aggregates }
}

function queryDatabase(dbPath, sql, startMs, reconcileStartMs) {
  if (!dbPath) return emptyResult(startMs)

  let db
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true, timeout: 5000 })
    db.pragma('cache_size = -8192')
    db.pragma('temp_store = FILE')
    const result = queryAggregate(db, sql, startMs)
    if (!Number.isFinite(reconcileStartMs)) return result
    return {
      ...result,
      recent: queryAggregate(db, sql, reconcileStartMs)
    }
  } finally {
    if (db) db.close()
  }
}

function query(payload) {
  const startMs = Number.isFinite(Number(payload.startMs)) ? Number(payload.startMs) : 0
  const reconcileStartMs = Number.isFinite(Number(payload.reconcileStartMs)) ? Number(payload.reconcileStartMs) : undefined
  if (payload.kind === 'opencode') {
    const dbPath = existingPath(Array.isArray(payload.dbPaths) ? payload.dbPaths : [])
    return queryDatabase(dbPath, OPENCODE_SQL, startMs, reconcileStartMs)
  }
  if (payload.kind === 'zcode') {
    return queryDatabase(typeof payload.dbPath === 'string' && fs.existsSync(payload.dbPath) ? payload.dbPath : null, ZCODE_SQL, startMs, reconcileStartMs)
  }
  throw new Error('unknown sqlite worker query kind')
}

let raw = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  raw += chunk
})
process.stdin.on('end', () => {
  try {
    process.stdout.write(JSON.stringify(query(JSON.parse(raw || '{}'))))
  } catch (err) {
    process.stderr.write(err && err.stack ? err.stack : String(err))
    process.exitCode = 1
  }
})
