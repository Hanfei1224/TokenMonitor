import fs from 'node:fs'
import os from 'node:os'
import readline from 'node:readline'
import path from 'node:path'
import { app } from 'electron'
import initSqlJs from 'sql.js'
import { getStorageDir } from './paths.js'

export interface TokenStatsRow {
  ts: number
  total: number
  input: number
  output: number
  cache_read: number
  cache_write: number
  source?: string
  provider?: string
  agent?: string
  model?: string
  estimated?: boolean
}

export interface DayStats {
  date: string
  total: number
  input: number
  output: number
  cache_read: number
  cache_write: number
  hit_rate: number
  requests: number
  byModel: Record<string, number>
  byModelCalls: Record<string, number>
}

export interface UsageBreakdown {
  bySource: Record<string, number>
  byProvider: Record<string, number>
  byAgent: Record<string, number>
  byModel: Record<string, number>
  byModelCalls: Record<string, number>
}

export interface TodayStats {
  total: number
  input: number
  output: number
  cache: number
  hit_rate: number
  requests: number
  estimated?: number
  breakdown?: UsageBreakdown
}

export interface MonthStatsData {
  days: Record<string, DayStats>
  summary: TodayStats
}

interface PersistentStatsCache {
  version: number
  watermarks: {
    opencode_max_ts: number
    zcode_max_ts: number
    claude_scan_time: number
    pi_scan_time: number
    codex_scan_time: number
  }
  days: Record<string, DayStats>
}

interface StatsCache {
  today: TodayStats
  months: Map<string, MonthStatsData>
  lastScanned: number
  isScanning: boolean
}

const STATS_CACHE_VERSION = 2

const emptyBreakdown = (): UsageBreakdown => ({
  bySource: {},
  byProvider: {},
  byAgent: {},
  byModel: {},
  byModelCalls: {}
})

const statsCache: StatsCache = {
  today: { total: 0, input: 0, output: 0, cache: 0, hit_rate: 0, requests: 0, estimated: 0, breakdown: emptyBreakdown() },
  months: new Map(),
  lastScanned: 0,
  isScanning: false
}

function bump(map: Record<string, number>, key: string | undefined, n: number) {
  if (!key || !n) return
  map[key] = (map[key] || 0) + n
}

function rowModel(r: TokenStatsRow): string {
  return r.model || r.provider || r.source || 'unknown'
}

let sqlJsInstance: any = null

function getWasmPath(): string {
  const appPath = app.getAppPath()
  const possiblePaths = [
    // Packaged app: prefer the unpacked file because WebAssembly loaders do
    // not consistently handle virtual paths inside app.asar.
    path.join(process.resourcesPath, 'app.asar.unpacked', 'dist-electron', 'main', 'sql-wasm.wasm'),
    path.join(process.resourcesPath, 'dist-electron', 'main', 'sql-wasm.wasm'),
    path.join(appPath, 'dist-electron', 'main', 'sql-wasm.wasm'),
    // Development and unpacked directory builds.
    path.join(appPath, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
    path.resolve(process.cwd(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
    path.resolve(process.cwd(), 'src', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')
  ]
  for (const wasmPath of possiblePaths) {
    if (fs.existsSync(wasmPath)) return wasmPath
  }
  throw new Error(`sql-wasm.wasm not found; searched: ${possiblePaths.join('; ')}`)
}

async function getSqlJs() {
  if (!sqlJsInstance) {
    const wasmPath = getWasmPath()
    if (wasmPath) {
      sqlJsInstance = await initSqlJs({
        locateFile: () => wasmPath
      })
    } else {
      sqlJsInstance = await initSqlJs()
    }
  }
  return sqlJsInstance
}

async function sqliteQueryAll(dbPath: string, sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
  if (!fs.existsSync(dbPath)) return []
  try {
    const SQL = await getSqlJs()
    const fileBuffer = fs.readFileSync(dbPath)
    const db = new SQL.Database(fileBuffer)
    const stmt = db.prepare(sql)
    if (params && params.length > 0) {
      stmt.bind(params)
    }
    const rows: Record<string, unknown>[] = []
    while (stmt.step()) {
      rows.push(stmt.getAsObject())
    }
    stmt.free()
    db.close()
    return rows
  } catch (err) {
    console.error('sqliteQueryAll (sql.js) failed on', dbPath, err)
    throw err
  }
}

function getCacheFilePath(): string {
  return path.join(getStorageDir(), 'stats_cache.json')
}

function loadPersistentCache(): PersistentStatsCache {
  const defaultCache: PersistentStatsCache = {
    version: STATS_CACHE_VERSION,
    watermarks: {
      opencode_max_ts: 0,
      zcode_max_ts: 0,
      claude_scan_time: 0,
      pi_scan_time: 0,
      codex_scan_time: 0
    },
    days: {}
  }

  const p = getCacheFilePath()
  if (fs.existsSync(p)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'))
      if (parsed?.version === STATS_CACHE_VERSION && parsed.days) {
        return {
          version: STATS_CACHE_VERSION,
          watermarks: { ...defaultCache.watermarks, ...(parsed.watermarks || {}) },
          days: parsed.days || {}
        }
      }
    } catch (e) {
      console.error('Failed to parse stats_cache.json:', e)
    }
  }
  return defaultCache
}

function savePersistentCache(data: PersistentStatsCache): void {
  try {
    const p = getCacheFilePath()
    fs.writeFileSync(p, JSON.stringify(data), 'utf-8')
  } catch (e) {
    console.error('Failed to save stats_cache.json:', e)
  }
}

function rebuildMonthMapFromDays(days: Record<string, DayStats>): {
  monthMap: Map<string, MonthStatsData>
  todaySummary: TodayStats
} {
  const monthMap = new Map<string, MonthStatsData>()
  const now = new Date()
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

  let todaySummary: TodayStats = {
    total: 0,
    input: 0,
    output: 0,
    cache: 0,
    hit_rate: 0,
    requests: 0,
    breakdown: emptyBreakdown()
  }

  for (const [dKey, dayObj] of Object.entries(days)) {
    const mKey = dKey.slice(0, 7) // 'YYYY-MM'
    if (!monthMap.has(mKey)) {
      monthMap.set(mKey, {
        days: {},
        summary: { total: 0, input: 0, output: 0, cache: 0, hit_rate: 0, requests: 0, breakdown: emptyBreakdown() }
      })
    }

    const mData = monthMap.get(mKey)!
    mData.days[dKey] = dayObj

    const mSum = mData.summary
    mSum.total += dayObj.total
    mSum.input += dayObj.input
    mSum.output += dayObj.output
    mSum.cache += (dayObj.cache_read + dayObj.cache_write)
    mSum.requests += dayObj.requests

    for (const [model, cnt] of Object.entries(dayObj.byModel || {})) {
      bump(mSum.breakdown!.byModel, model, cnt)
    }
    for (const [model, calls] of Object.entries(dayObj.byModelCalls || {})) {
      bump(mSum.breakdown!.byModelCalls, model, calls)
    }

    if (dKey === todayKey) {
      todaySummary = {
        total: dayObj.total,
        input: dayObj.input,
        output: dayObj.output,
        cache: dayObj.cache_read + dayObj.cache_write,
        hit_rate: dayObj.hit_rate,
        requests: dayObj.requests,
        breakdown: {
          bySource: {},
          byProvider: {},
          byAgent: {},
          byModel: { ...(dayObj.byModel || {}) },
          byModelCalls: { ...(dayObj.byModelCalls || {}) }
        }
      }
    }
  }

  for (const [, mData] of monthMap) {
    if (mData.summary.input + mData.summary.cache > 0) {
      mData.summary.hit_rate = Math.round((mData.summary.cache / (mData.summary.input + mData.summary.cache)) * 100)
    }
  }

  return { monthMap, todaySummary }
}

// 启动时立即同步载入持久化缓存（0 毫秒就绪）
try {
  const diskCache = loadPersistentCache()
  if (Object.keys(diskCache.days).length > 0) {
    const { monthMap, todaySummary } = rebuildMonthMapFromDays(diskCache.days)
    statsCache.months = monthMap
    statsCache.today = todaySummary
  }
} catch (e) {
  console.error('Initial cache load error:', e)
}

function isoToMs(ts: string): number {
  const n = new Date(ts.replace('Z', '+00:00')).getTime()
  return Number.isNaN(n) ? 0 : n
}

async function walkJsonl(
  root: string,
  filterMtimeMs: number,
  parseLine: (line: string) => TokenStatsRow | null
): Promise<TokenStatsRow[]> {
  const rows: TokenStatsRow[] = []
  if (!fs.existsSync(root)) return rows

  async function walkDir(dir: string) {
    let entries: fs.Dirent[]
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walkDir(fullPath)
        continue
      }
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue
      try {
        const stat = await fs.promises.stat(fullPath)
        if (filterMtimeMs > 0 && stat.mtimeMs < filterMtimeMs) continue
        const stream = fs.createReadStream(fullPath, { encoding: 'utf-8' })
        const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })
        for await (const line of rl) {
          const row = parseLine(line)
          if (row && (filterMtimeMs === 0 || row.ts > filterMtimeMs)) rows.push(row)
        }
      } catch {
        // skip unreadable file
      }
    }
  }

  await walkDir(root)
  return rows
}

function opencodeDbPaths(): string[] {
  return [
    path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db'),
    path.join(os.homedir(), 'AppData', 'Roaming', 'opencode', 'opencode.db'),
    path.join(os.homedir(), 'Library', 'Application Support', 'opencode', 'opencode.db')
  ]
}

type OpenCodeMsg = {
  session_id: string
  ts: number
  total: number
  input: number
  output: number
  reasoning: number
  cache_read: number
  cache_write: number
  hasError: number
  completed: number | null
  provider: string | null
  model: string | null
  agent: string | null
}

function toOpencodeRow(m: OpenCodeMsg): TokenStatsRow {
  const output = Number(m.output || 0) + Number(m.reasoning || 0)
  const total = Math.max(Number(m.total || 0), m.input + output + m.cache_read + m.cache_write)
  return {
    ts: m.ts,
    total,
    input: Number(m.input || 0),
    output,
    cache_read: Number(m.cache_read || 0),
    cache_write: Number(m.cache_write || 0),
    source: 'opencode',
    provider: m.provider || undefined,
    agent: m.agent || undefined,
    model: m.model || undefined
  }
}

async function scanOpencodeRows(startMs: number): Promise<{ rows: TokenStatsRow[]; maxTs: number }> {
  let queried: Record<string, unknown>[] = []
  for (const dbPath of opencodeDbPaths()) {
    queried = await sqliteQueryAll(
      dbPath,
      `SELECT session_id,
              time_created AS ts,
              COALESCE(json_extract(data,'$.tokens.total'),0) AS total,
              COALESCE(json_extract(data,'$.tokens.input'),0) AS input,
              COALESCE(json_extract(data,'$.tokens.output'),0) AS output,
              COALESCE(json_extract(data,'$.tokens.reasoning'),0) AS reasoning,
              COALESCE(json_extract(data,'$.tokens.cache.read'),0) AS cache_read,
              COALESCE(json_extract(data,'$.tokens.cache.write'),0) AS cache_write,
              json_extract(data,'$.time.completed') AS completed,
              CASE WHEN json_extract(data,'$.error') IS NULL THEN 0 ELSE 1 END AS has_error,
              json_extract(data,'$.providerID') AS provider,
              json_extract(data,'$.modelID') AS model,
              COALESCE(json_extract(data,'$.agent'), json_extract(data,'$.mode')) AS agent
       FROM message
       WHERE json_extract(data,'$.role')='assistant' AND time_created > ?
       ORDER BY time_created ASC`,
      [startMs]
    )
    if (queried.length || fs.existsSync(dbPath)) break
  }

  let maxTs = startMs
  const rows: TokenStatsRow[] = []
  for (const r of queried) {
    const ts = Number(r.ts || 0)
    if (ts > maxTs) maxTs = ts
    const output = Number(r.output || 0) + Number(r.reasoning || 0)
    const total = Math.max(Number(r.total || 0), Number(r.input || 0) + output + Number(r.cache_read || 0) + Number(r.cache_write || 0))
    rows.push({
      ts,
      total,
      input: Number(r.input || 0),
      output,
      cache_read: Number(r.cache_read || 0),
      cache_write: Number(r.cache_write || 0),
      source: 'opencode',
      provider: r.provider ? String(r.provider) : undefined,
      model: r.model ? String(r.model) : undefined,
      agent: r.agent ? String(r.agent) : undefined
    })
  }

  return { rows, maxTs }
}

async function scanZcodeRows(startMs: number): Promise<{ rows: TokenStatsRow[]; maxTs: number }> {
  const dbPath = path.join(os.homedir(), '.zcode', 'cli', 'db', 'db.sqlite')
  const queried = await sqliteQueryAll(
    dbPath,
    `SELECT started_at, input_tokens, output_tokens, cache_creation_input_tokens,
            cache_read_input_tokens, computed_total_tokens, agent, provider_id, model_id
     FROM model_usage
     WHERE status='completed' AND computed_total_tokens > 0 AND started_at > ?
     ORDER BY started_at ASC`,
    [startMs]
  )
  let maxTs = startMs
  const rows: TokenStatsRow[] = []
  for (const r of queried) {
    const ts = Number(r.started_at || 0)
    if (ts > maxTs) maxTs = ts
    const cr = Number(r.cache_read_input_tokens || 0)
    const cw = Number(r.cache_creation_input_tokens || 0)
    const inp = Number(r.input_tokens || 0)
    rows.push({
      ts,
      total: Number(r.computed_total_tokens || 0),
      input: Math.max(0, inp - cr - cw),
      output: Number(r.output_tokens || 0),
      cache_read: cr,
      cache_write: cw,
      source: 'zcode',
      provider: r.provider_id ? String(r.provider_id) : 'zcode',
      agent: r.agent ? String(r.agent) : undefined,
      model: r.model_id ? String(r.model_id) : undefined
    })
  }
  return { rows, maxTs }
}

function scanClaudeRowsAsync(filterMtimeMs: number): Promise<TokenStatsRow[]> {
  return walkJsonl(path.join(os.homedir(), '.claude', 'projects'), filterMtimeMs, (line) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed[0] !== '{') return null
    try {
      const j = JSON.parse(trimmed)
      if (j.type !== 'assistant') return null
      const u = j.message?.usage
      if (!u) return null
      const ts = isoToMs(j.timestamp || '')
      if (!ts) return null
      const input = Number(u.input_tokens || 0)
      const output = Number(u.output_tokens || 0)
      const cw = Number(u.cache_creation_input_tokens || 0)
      const cr = Number(u.cache_read_input_tokens || 0)
      const total = input + output + cw + cr
      if (total <= 0) return null
      return {
        ts,
        total,
        input,
        output,
        cache_read: cr,
        cache_write: cw,
        source: 'claude',
        provider: 'claude',
        model: String(j.message?.model || j.model || 'claude')
      }
    } catch {
      return null
    }
  })
}

function scanPiRowsAsync(filterMtimeMs: number): Promise<TokenStatsRow[]> {
  return walkJsonl(path.join(os.homedir(), '.pi', 'agent', 'sessions'), filterMtimeMs, (line) => {
    if (!line.includes('totalTokens')) return null
    try {
      const j = JSON.parse(line)
      const u = j.message?.usage
      if (!u) return null
      const total = Number(u.totalTokens || 0)
      if (!total) return null
      const ts = isoToMs(j.timestamp || '')
      if (!ts) return null
      return {
        ts,
        total,
        input: Number(u.input || 0),
        output: Number(u.output || 0),
        cache_read: Number(u.cacheRead || 0),
        cache_write: Number(u.cacheWrite || 0),
        source: 'pi',
        provider: 'pi',
        model: String(u.model || j.model || j.message?.model || 'pi')
      }
    } catch {
      return null
    }
  })
}

function scanCodexRowsAsync(filterMtimeMs: number): Promise<TokenStatsRow[]> {
  return walkJsonl(path.join(os.homedir(), '.codex', 'sessions'), filterMtimeMs, (line) => {
    if (!line.includes('"token_count"')) return null
    try {
      const j = JSON.parse(line)
      const p = j.payload || {}
      if (p.type !== 'token_count') return null
      const u = p.info?.last_token_usage || {}
      const total = Number(u.total_tokens || 0)
      if (!total) return null
      const ts = isoToMs(j.timestamp || '')
      if (!ts) return null
      const inp = Number(u.input_tokens || 0)
      const cr = Number(u.cached_input_tokens || 0)
      return {
        ts,
        total,
        input: Math.max(0, inp - cr),
        output: Number(u.output_tokens || 0),
        cache_read: cr,
        cache_write: 0,
        source: 'codex',
        provider: 'codex',
        model: String(p.info?.model || 'codex')
      }
    } catch {
      return null
    }
  })
}

/**
 * 增量扫描与持久化合并算法
 */
export async function aggregateFullStats(): Promise<void> {
  if (statsCache.isScanning) return
  statsCache.isScanning = true

  try {
    const diskCache = loadPersistentCache()
    const isFirstTime = Object.keys(diskCache.days).length === 0

    const now = new Date()
    const startOf90Days = new Date(now.getFullYear(), now.getMonth() - 3, 1).getTime()

    // 增量起点时间戳
    const opencodeStartTs = isFirstTime ? startOf90Days : (diskCache.watermarks.opencode_max_ts || startOf90Days)
    const zcodeStartTs = isFirstTime ? startOf90Days : (diskCache.watermarks.zcode_max_ts || startOf90Days)
    const claudeMtime = isFirstTime ? 0 : (diskCache.watermarks.claude_scan_time || 0)
    const piMtime = isFirstTime ? 0 : (diskCache.watermarks.pi_scan_time || 0)
    const codexMtime = isFirstTime ? 0 : (diskCache.watermarks.codex_scan_time || 0)

    const scanStartTime = Date.now()

    // 并发增量采集
    const [opencodeRes, zcodeRes, claudeRows, piRows, codexRows] = await Promise.all([
      scanOpencodeRows(opencodeStartTs),
      scanZcodeRows(zcodeStartTs),
      scanClaudeRowsAsync(claudeMtime),
      scanPiRowsAsync(piMtime),
      scanCodexRowsAsync(codexMtime)
    ])

    const incrementalRows = [
      ...opencodeRes.rows,
      ...zcodeRes.rows,
      ...claudeRows,
      ...piRows,
      ...codexRows
    ]

    // 将增量数据合并入缓存字典
    const daysMap = { ...diskCache.days }

    // 如果是首日或者今天有新数据，更新 today
    for (const r of incrementalRows) {
      const d = new Date(r.ts)
      const y = d.getFullYear()
      const m = d.getMonth() + 1
      const day = d.getDate()
      const dKey = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`

      if (!daysMap[dKey]) {
        daysMap[dKey] = {
          date: dKey,
          total: 0,
          input: 0,
          output: 0,
          cache_read: 0,
          cache_write: 0,
          hit_rate: 0,
          requests: 0,
          byModel: {},
          byModelCalls: {}
        }
      }

      const dayObj = daysMap[dKey]
      dayObj.total += r.total
      dayObj.input += r.input
      dayObj.output += r.output
      dayObj.cache_read += r.cache_read
      dayObj.cache_write += r.cache_write
      dayObj.requests += 1

      const modelName = rowModel(r)
      bump(dayObj.byModel, modelName, r.total)
      bump(dayObj.byModelCalls, modelName, 1)

      const cacheTotal = dayObj.cache_read + dayObj.cache_write
      if (dayObj.input + cacheTotal > 0) {
        dayObj.hit_rate = Math.round((cacheTotal / (dayObj.input + cacheTotal)) * 100)
      }
    }

    // 更新水库刻度线
    const updatedWatermarks = {
      opencode_max_ts: Math.max(diskCache.watermarks.opencode_max_ts || 0, opencodeRes.maxTs),
      zcode_max_ts: Math.max(diskCache.watermarks.zcode_max_ts || 0, zcodeRes.maxTs),
      claude_scan_time: scanStartTime,
      pi_scan_time: scanStartTime,
      codex_scan_time: scanStartTime
    }

    // 重构内存月度数据
    const { monthMap, todaySummary } = rebuildMonthMapFromDays(daysMap)
    statsCache.months = monthMap
    statsCache.today = todaySummary
    statsCache.lastScanned = Date.now()

    // 持久化保存至磁盘安装目录
    savePersistentCache({
      version: STATS_CACHE_VERSION,
      watermarks: updatedWatermarks,
      days: daysMap
    })
  } catch (err) {
    console.error('aggregateFullStats incremental scan failed:', err)
  } finally {
    statsCache.isScanning = false
  }
}

export function startStatsBackgroundScanner(): void {
  aggregateFullStats()
  setInterval(aggregateFullStats, 60 * 1000)
}

export function getCachedTodayStats(): TodayStats {
  return statsCache.today
}

export function getCachedMonthStats(year: number, month: number): MonthStatsData {
  const mKey = `${year}-${String(month).padStart(2, '0')}`
  if (statsCache.months.has(mKey)) {
    return statsCache.months.get(mKey)!
  }
  return {
    days: {},
    summary: { total: 0, input: 0, output: 0, cache: 0, hit_rate: 0, requests: 0, breakdown: emptyBreakdown() }
  }
}
