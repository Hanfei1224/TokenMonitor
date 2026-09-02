import fs from 'node:fs'
import os from 'node:os'
import readline from 'node:readline'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { app } from 'electron'
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

let statsBackgroundScannerStarted = false
let statsInterval: ReturnType<typeof setInterval> | null = null

interface JsonlFileState {
  size: number
  mtimeMs: number
}

const jsonlFileStates = new Map<string, JsonlFileState>()
const activeSqliteWorkers = new Set<ReturnType<typeof spawn>>()

function bump(map: Record<string, number>, key: string | undefined, n: number) {
  if (!key || !n) return
  map[key] = (map[key] || 0) + n
}

function rowModel(r: TokenStatsRow): string {
  return r.model || r.provider || r.source || 'unknown'
}

type AggregateDays = Record<string, DayStats>

interface AggregateScan {
  days: AggregateDays
  maxTs: number
  successful: boolean
}

interface SqliteWorkerRequest {
  kind: 'opencode' | 'zcode'
  dbPath?: string
  dbPaths?: string[]
  startMs: number
}

const SQLITE_WORKER_TIMEOUT_MS = 60 * 1000

function createDayStats(date: string): DayStats {
  return {
    date,
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

function dayKeyForTimestamp(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function updateHitRate(day: DayStats): void {
  const cacheTotal = day.cache_read + day.cache_write
  if (day.input + cacheTotal > 0) {
    day.hit_rate = Math.round((cacheTotal / (day.input + cacheTotal)) * 100)
  }
}

function addTokenRow(days: AggregateDays, row: TokenStatsRow): void {
  const date = dayKeyForTimestamp(row.ts)
  const day = days[date] || (days[date] = createDayStats(date))

  day.total += row.total
  day.input += row.input
  day.output += row.output
  day.cache_read += row.cache_read
  day.cache_write += row.cache_write
  day.requests += 1

  const model = rowModel(row)
  bump(day.byModel, model, row.total)
  bump(day.byModelCalls, model, 1)
  updateHitRate(day)
}

function mergeAggregateDays(target: AggregateDays, source: AggregateDays): void {
  for (const [date, sourceDay] of Object.entries(source)) {
    const targetDay = target[date] || (target[date] = createDayStats(date))
    targetDay.total += sourceDay.total
    targetDay.input += sourceDay.input
    targetDay.output += sourceDay.output
    targetDay.cache_read += sourceDay.cache_read
    targetDay.cache_write += sourceDay.cache_write
    targetDay.requests += sourceDay.requests

    for (const [model, total] of Object.entries(sourceDay.byModel || {})) {
      bump(targetDay.byModel, model, total)
    }
    for (const [model, calls] of Object.entries(sourceDay.byModelCalls || {})) {
      bump(targetDay.byModelCalls, model, calls)
    }
    updateHitRate(targetDay)
  }
}

function firstExistingFile(candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

function sqliteWorkerPath(): string | null {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'app.asar.unpacked', 'dist-electron', 'main', 'sqlite-worker.cjs')]
    : [
        path.join(app.getAppPath(), 'dist-electron', 'main', 'sqlite-worker.cjs'),
        path.join(app.getAppPath(), 'main', 'sqlite-worker.cjs'),
        path.resolve(process.cwd(), 'dist-electron', 'main', 'sqlite-worker.cjs'),
        path.resolve(process.cwd(), 'src', 'dist-electron', 'main', 'sqlite-worker.cjs')
      ]
  return firstExistingFile(candidates)
}

function sqliteNodePath(): string | null {
  const nodeName = process.platform === 'win32' ? 'node.exe' : 'node'
  if (app.isPackaged) {
    // The worker must use the Node runtime shipped with the installer, never Electron.
    return firstExistingFile([path.join(process.resourcesPath, 'node-runtime', nodeName)])
  }

  const configured = process.env.TOKENMONITOR_NODE_PATH?.trim()
  if (configured) {
    if (!path.isAbsolute(configured) || !fs.existsSync(configured)) {
      throw new Error(`TOKENMONITOR_NODE_PATH must point to an existing absolute Node executable: ${configured}`)
    }
    return configured
  }
  return 'node'
}

async function runSqliteWorker(request: SqliteWorkerRequest): Promise<unknown> {
  const nodePath = sqliteNodePath()
  const workerPath = sqliteWorkerPath()
  if (!nodePath) {
    const nodeName = process.platform === 'win32' ? 'node.exe' : 'node'
    throw new Error(`SQLite statistics unavailable: packaged Node runtime was not found at ${path.join(process.resourcesPath, 'node-runtime', nodeName)}`)
  }
  if (!workerPath) {
    throw new Error(`SQLite statistics disabled: worker script was not found${app.isPackaged ? ' in the packaged resources' : ''}`)
  }

  const child = spawn(nodePath, [workerPath], {
    cwd: path.dirname(workerPath),
    env: process.env,
    windowsHide: true,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  activeSqliteWorkers.add(child)

  let stdout = ''
  let stderr = ''
  let timer: ReturnType<typeof setTimeout> | undefined

  try {
    return await new Promise<unknown>((resolve, reject) => {
      let settled = false
      const finish = (error?: Error, value?: unknown) => {
        if (settled) return
        settled = true
        if (error) reject(error)
        else resolve(value)
      }

      child.stdout?.setEncoding('utf8')
      child.stderr?.setEncoding('utf8')
      child.stdout?.on('data', (chunk: string) => {
        stdout += chunk
      })
      child.stderr?.on('data', (chunk: string) => {
        stderr += chunk
      })
      child.once('error', (error) => finish(error instanceof Error ? error : new Error(String(error))))
      child.once('close', (code, signal) => {
        if (code !== 0) {
          const detail = stderr.trim() || `exit code ${code ?? 'null'}${signal ? `, signal ${signal}` : ''}`
          finish(new Error(`SQLite worker failed: ${detail}`))
          return
        }
        try {
          finish(undefined, JSON.parse(stdout))
        } catch (error) {
          finish(new Error(`SQLite worker returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`))
        }
      })

      timer = setTimeout(() => {
        child.kill()
        finish(new Error(`SQLite worker timed out after ${SQLITE_WORKER_TIMEOUT_MS}ms`))
      }, SQLITE_WORKER_TIMEOUT_MS)

      try {
        child.stdin?.end(JSON.stringify(request))
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)))
      }
    })
  } finally {
    if (timer) clearTimeout(timer)
    if (child.exitCode === null && !child.killed) child.kill()
    activeSqliteWorkers.delete(child)
  }
}

function numericAggregateValue(value: unknown, field: string): number {
  const n = Number(value)
  if (!Number.isFinite(n)) throw new Error(`SQLite worker returned invalid ${field}`)
  return n
}

function parseSqliteAggregate(value: unknown, startMs: number): AggregateScan {
  if (!value || typeof value !== 'object') throw new Error('SQLite worker returned a non-object result')
  const result = value as { maxTs?: unknown; aggregates?: unknown }
  if (!Array.isArray(result.aggregates)) throw new Error('SQLite worker returned no aggregate list')

  const days: AggregateDays = {}
  let maxTs = Math.max(startMs, numericAggregateValue(result.maxTs ?? startMs, 'maxTs'))
  for (const item of result.aggregates) {
    if (!item || typeof item !== 'object') throw new Error('SQLite worker returned an invalid aggregate')
    const row = item as Record<string, unknown>
    const date = typeof row.date === 'string' ? row.date : ''
    const model = typeof row.model === 'string' ? row.model : ''
    if (!date || !model) throw new Error('SQLite worker returned an aggregate without date or model')

    const day = days[date] || (days[date] = createDayStats(date))
    const total = numericAggregateValue(row.total, 'total')
    const input = numericAggregateValue(row.input, 'input')
    const output = numericAggregateValue(row.output, 'output')
    const cacheRead = numericAggregateValue(row.cache_read, 'cache_read')
    const cacheWrite = numericAggregateValue(row.cache_write, 'cache_write')
    const requests = numericAggregateValue(row.requests, 'requests')
    day.total += total
    day.input += input
    day.output += output
    day.cache_read += cacheRead
    day.cache_write += cacheWrite
    day.requests += requests
    bump(day.byModel, model, total)
    bump(day.byModelCalls, model, requests)
    updateHitRate(day)

    const rowMaxTs = Number(row.max_ts)
    if (Number.isFinite(rowMaxTs)) maxTs = Math.max(maxTs, rowMaxTs)
  }

  return { days, maxTs, successful: true }
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
): Promise<AggregateDays> {
  const days: AggregateDays = {}
  if (!fs.existsSync(root)) return days

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
      let stream: fs.ReadStream | null = null
      let rl: readline.Interface | null = null
      try {
        const stat = await fs.promises.stat(fullPath)
        const previous = jsonlFileStates.get(fullPath)
        const currentState = { size: stat.size, mtimeMs: stat.mtimeMs }
        if (filterMtimeMs > 0 && stat.mtimeMs < filterMtimeMs) {
          jsonlFileStates.set(fullPath, currentState)
          continue
        }
        if (filterMtimeMs > 0 && previous?.size === stat.size && previous.mtimeMs === stat.mtimeMs) continue
        stream = fs.createReadStream(fullPath, { encoding: 'utf-8' })
        rl = readline.createInterface({ input: stream, crlfDelay: Infinity })
        for await (const line of rl) {
          const row = parseLine(line)
          if (row && (filterMtimeMs === 0 || row.ts > filterMtimeMs)) addTokenRow(days, row)
        }
        const finalStat = await fs.promises.stat(fullPath)
        jsonlFileStates.set(fullPath, { size: finalStat.size, mtimeMs: finalStat.mtimeMs })
      } catch {
        // skip unreadable file
      } finally {
        rl?.close()
        stream?.destroy()
      }
    }
  }

  await walkDir(root)
  return days
}

function opencodeDbPaths(): string[] {
  return [
    path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db'),
    path.join(os.homedir(), 'AppData', 'Roaming', 'opencode', 'opencode.db'),
    path.join(os.homedir(), 'Library', 'Application Support', 'opencode', 'opencode.db')
  ]
}

async function scanOpencodeAggregate(startMs: number): Promise<AggregateScan> {
  const dbPaths = opencodeDbPaths()
  if (!dbPaths.some((dbPath) => fs.existsSync(dbPath))) {
    return { days: {}, maxTs: startMs, successful: true }
  }

  try {
    const result = await runSqliteWorker({ kind: 'opencode', dbPaths, startMs })
    return parseSqliteAggregate(result, startMs)
  } catch (err) {
    console.error('OpenCode SQLite worker scan skipped:', err)
    // Keep the watermark unchanged so a later scan retries the missing data.
    return { days: {}, maxTs: startMs, successful: false }
  }
}

async function scanZcodeAggregate(startMs: number): Promise<AggregateScan> {
  const dbPath = path.join(os.homedir(), '.zcode', 'cli', 'db', 'db.sqlite')
  if (!fs.existsSync(dbPath)) {
    return { days: {}, maxTs: startMs, successful: true }
  }

  try {
    const result = await runSqliteWorker({ kind: 'zcode', dbPath, startMs })
    return parseSqliteAggregate(result, startMs)
  } catch (err) {
    console.error('ZCode SQLite worker scan skipped:', err)
    // Keep the watermark unchanged so a later scan retries the missing data.
    return { days: {}, maxTs: startMs, successful: false }
  }
}

function scanClaudeAggregateAsync(filterMtimeMs: number): Promise<AggregateDays> {
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

function scanPiAggregateAsync(filterMtimeMs: number): Promise<AggregateDays> {
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

function scanCodexAggregateAsync(filterMtimeMs: number): Promise<AggregateDays> {
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

    // 并发增量采集；每个数据源只保留按天/模型聚合桶。
    const [opencodeRes, zcodeRes, claudeDays, piDays, codexDays] = await Promise.all([
      scanOpencodeAggregate(opencodeStartTs),
      scanZcodeAggregate(zcodeStartTs),
      scanClaudeAggregateAsync(claudeMtime),
      scanPiAggregateAsync(piMtime),
      scanCodexAggregateAsync(codexMtime)
    ])

    // 将增量数据合并入缓存字典
    const daysMap = { ...diskCache.days }
    mergeAggregateDays(daysMap, opencodeRes.days)
    mergeAggregateDays(daysMap, zcodeRes.days)
    mergeAggregateDays(daysMap, claudeDays)
    mergeAggregateDays(daysMap, piDays)
    mergeAggregateDays(daysMap, codexDays)

    // 更新水库刻度线
    const updatedWatermarks = {
      opencode_max_ts: opencodeRes.successful
        ? Math.max(diskCache.watermarks.opencode_max_ts || 0, opencodeRes.maxTs)
        : diskCache.watermarks.opencode_max_ts || 0,
      zcode_max_ts: zcodeRes.successful
        ? Math.max(diskCache.watermarks.zcode_max_ts || 0, zcodeRes.maxTs)
        : diskCache.watermarks.zcode_max_ts || 0,
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
  if (statsBackgroundScannerStarted) return
  statsBackgroundScannerStarted = true
  void aggregateFullStats()
  statsInterval = setInterval(() => {
    void aggregateFullStats()
  }, 60 * 1000)
}

export function stopStatsBackgroundScanner(): void {
  if (statsInterval) {
    clearInterval(statsInterval)
    statsInterval = null
  }
  for (const worker of activeSqliteWorkers) {
    if (worker.exitCode === null && !worker.killed) worker.kill()
  }
  activeSqliteWorkers.clear()
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
