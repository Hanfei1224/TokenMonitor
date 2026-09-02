import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { StringDecoder } from 'node:string_decoder'

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

export type AggregateDays = Record<string, DayStats>
export type JsonlSource = 'claude' | 'pi' | 'codex'

export interface JsonlFileState {
  source: JsonlSource
  size: number
  mtimeMs: number
  identity: string
  prefixHash: string
  offset: number
  days: AggregateDays
}

export interface JsonlSourceScan {
  states: Record<string, JsonlFileState>
  complete: boolean
}

function rowModel(row: TokenStatsRow): string {
  return row.model || row.provider || row.source || 'unknown'
}

export function createDayStats(date: string): DayStats {
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

function bump(map: Record<string, number>, key: string, amount: number): void {
  if (!amount) return
  map[key] = (map[key] || 0) + amount
}

function updateHitRate(day: DayStats): void {
  const cacheTotal = day.cache_read + day.cache_write
  if (day.input + cacheTotal > 0) {
    day.hit_rate = Math.round((cacheTotal / (day.input + cacheTotal)) * 100)
  }
}

function dayKeyForTimestamp(ts: number): string {
  const date = new Date(ts)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function addTokenRow(days: AggregateDays, row: TokenStatsRow): void {
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

export function cloneAggregateDays(source: AggregateDays): AggregateDays {
  const copy: AggregateDays = {}
  for (const [date, day] of Object.entries(source)) {
    copy[date] = {
      date: day.date || date,
      total: Number(day.total) || 0,
      input: Number(day.input) || 0,
      output: Number(day.output) || 0,
      cache_read: Number(day.cache_read) || 0,
      cache_write: Number(day.cache_write) || 0,
      hit_rate: Number(day.hit_rate) || 0,
      requests: Number(day.requests) || 0,
      byModel: { ...(day.byModel || {}) },
      byModelCalls: { ...(day.byModelCalls || {}) }
    }
  }
  return copy
}

export function mergeAggregateDays(target: AggregateDays, source: AggregateDays): void {
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

async function hashFilePrefix(filePath: string): Promise<string> {
  const handle = await fs.promises.open(filePath, 'r')
  try {
    const buffer = Buffer.allocUnsafe(4096)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    return crypto.createHash('sha256').update(buffer.subarray(0, bytesRead)).digest('hex')
  } finally {
    await handle.close()
  }
}

interface JsonlReadResult {
  days: AggregateDays
  nextOffset: number
}

async function readJsonlFile(
  filePath: string,
  startOffset: number,
  parseLine: (line: string) => TokenStatsRow | null
): Promise<JsonlReadResult> {
  const stream = fs.createReadStream(filePath, { start: startOffset })
  const decoder = new StringDecoder('utf8')
  const days: AggregateDays = {}
  let buffered = ''
  let bytesRead = 0
  let completeOffset = startOffset
  const safeParseLine = (line: string): TokenStatsRow | null => {
    try {
      return parseLine(line)
    } catch {
      return null
    }
  }

  for await (const chunk of stream) {
    bytesRead += chunk.length
    buffered += decoder.write(chunk)

    let newlineIndex = buffered.indexOf('\n')
    while (newlineIndex >= 0) {
      const line = buffered.slice(0, newlineIndex)
      const consumed = buffered.slice(0, newlineIndex + 1)
      const row = safeParseLine(line)
      if (row) addTokenRow(days, row)
      completeOffset += Buffer.byteLength(consumed, 'utf8')
      buffered = buffered.slice(newlineIndex + 1)
      newlineIndex = buffered.indexOf('\n')
    }
  }

  buffered += decoder.end()
  if (buffered.trim()) {
    const row = safeParseLine(buffered)
    if (row) {
      addTokenRow(days, row)
      completeOffset = startOffset + bytesRead
    } else {
      try {
        JSON.parse(buffered)
        completeOffset = startOffset + bytesRead
      } catch {
        // Keep the incomplete final line for the next scan.
      }
    }
  } else {
    completeOffset = startOffset + bytesRead
  }

  return { days, nextOffset: completeOffset }
}

function fileIdentity(stat: fs.Stats): string {
  return `${stat.dev}:${stat.ino}`
}

function canSkipFile(stat: fs.Stats, previous: JsonlFileState | undefined): boolean {
  return Boolean(
    previous &&
      previous.size === stat.size &&
      previous.mtimeMs === stat.mtimeMs &&
      previous.identity === fileIdentity(stat) &&
      previous.offset >= stat.size
  )
}

function canAppendFile(stat: fs.Stats, previous: JsonlFileState | undefined, prefixHash: string): boolean {
  return Boolean(
    previous &&
      stat.size >= previous.size &&
      previous.offset <= previous.size &&
      previous.identity === fileIdentity(stat) &&
      previous.prefixHash === prefixHash
  )
}

export async function scanJsonlRoot(
  root: string,
  source: JsonlSource,
  knownStates: Record<string, JsonlFileState>,
  parseLine: (line: string) => TokenStatsRow | null
): Promise<JsonlSourceScan> {
  const states: Record<string, JsonlFileState> = { ...knownStates }
  let complete = true

  if (!fs.existsSync(root)) return { states, complete }

  async function walkDir(dir: string): Promise<void> {
    let entries: fs.Dirent[]
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true })
    } catch {
      complete = false
      return
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walkDir(fullPath)
        continue
      }
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue

      const previous = states[fullPath]
      try {
        const stat = await fs.promises.stat(fullPath)
        if (canSkipFile(stat, previous)) continue

        const prefixHash = await hashFilePrefix(fullPath)
        const append = canAppendFile(stat, previous, prefixHash)
        const startOffset = append ? previous!.offset : 0
        const result = await readJsonlFile(fullPath, startOffset, parseLine)
        const finalStat = await fs.promises.stat(fullPath)
        if (result.nextOffset > finalStat.size) throw new Error('JSONL file was truncated while scanning')

        const days = append ? cloneAggregateDays(previous!.days) : {}
        mergeAggregateDays(days, result.days)
        states[fullPath] = {
          source,
          size: finalStat.size,
          mtimeMs: finalStat.mtimeMs,
          identity: fileIdentity(finalStat),
          prefixHash,
          offset: result.nextOffset,
          days
        }
      } catch {
        complete = false
      }
    }
  }

  await walkDir(root)
  return { states, complete }
}
