export interface CodexUsageWindow {
  id: string
  label: string
  percent: number
  resetsAt: string | null
  windowDurationMins: number | null
}

export interface CodexQuotaData {
  configured: boolean
  planType?: string
  email?: string
  windows?: CodexUsageWindow[]
  error?: string | null
}

type JsonRecord = Record<string, unknown>

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    return Number(value)
  }
  return undefined
}

function firstValue(record: JsonRecord, ...keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key]
  }
  return undefined
}

function toResetIso(resetAt: unknown, resetAfterSeconds: unknown): string | null {
  const resetAtNumber = asNumber(resetAt)
  if (resetAtNumber !== undefined && resetAtNumber > 0) {
    const milliseconds = resetAtNumber > 1_000_000_000_000 ? resetAtNumber : resetAtNumber * 1000
    const date = new Date(milliseconds)
    if (!Number.isNaN(date.getTime())) return date.toISOString()
  }

  const resetAtString = asString(resetAt)
  if (resetAtString) {
    const date = new Date(resetAtString)
    if (!Number.isNaN(date.getTime())) return date.toISOString()
  }

  const seconds = asNumber(resetAfterSeconds)
  if (seconds !== undefined && seconds > 0) {
    return new Date(Date.now() + seconds * 1000).toISOString()
  }

  return null
}

function windowLabel(id: string, durationMins: number | null): string {
  if (durationMins === 300) return '5H余额'
  if (durationMins === 10_080) return '本周余额'
  if (durationMins !== null) {
    if (durationMins >= 40_320 && durationMins <= 44_640) return '本月余额'
    if (durationMins % 1_440 === 0) return `${durationMins / 1_440}天余额`
    if (durationMins % 60 === 0) return `${durationMins / 60}小时余额`
    return `${durationMins}分钟余额`
  }
  if (id.includes('primary')) return '主窗口'
  if (id.includes('secondary')) return '次窗口'
  return `${id}余额`
}

function parseWindow(id: string, value: unknown): CodexUsageWindow | null {
  const record = asRecord(value)
  if (!record) return null

  const usedPercent = asNumber(firstValue(record, 'used_percent', 'usedPercent'))
  if (usedPercent === undefined) return null

  const durationSeconds = asNumber(firstValue(record, 'limit_window_seconds', 'limitWindowSeconds'))
  const durationMinsValue = asNumber(firstValue(record, 'window_duration_mins', 'windowDurationMins'))
  const windowDurationMins = durationSeconds !== undefined
    ? Math.max(1, Math.round(durationSeconds / 60))
    : durationMinsValue !== undefined
      ? Math.max(1, Math.round(durationMinsValue))
      : null

  const percent = Math.min(100, Math.max(0, Math.round(100 - usedPercent)))
  return {
    id,
    label: windowLabel(id, windowDurationMins),
    percent,
    resetsAt: toResetIso(
      firstValue(record, 'reset_at', 'resetAt', 'resets_at', 'resetsAt'),
      firstValue(record, 'reset_after_seconds', 'resetAfterSeconds')
    ),
    windowDurationMins
  }
}

function findCodexSnapshot(value: unknown): JsonRecord | null {
  if (Array.isArray(value)) {
    const snapshot = value.find((entry) => {
      const record = asRecord(entry)
      return record && (record.limit_id === 'codex' || record.limitId === 'codex')
    })
    return asRecord(snapshot)
  }

  const record = asRecord(value)
  if (!record) return null
  const codex = asRecord(record.codex)
  if (codex) return codex
  if (record.primary || record.primary_window || record.secondary || record.secondary_window) return record
  return null
}

function parseWindows(payload: JsonRecord): CodexUsageWindow[] {
  const rateLimit = asRecord(firstValue(payload, 'rate_limit', 'rateLimit'))
  const directSource = rateLimit || findCodexSnapshot(firstValue(payload, 'rateLimitsByLimitId', 'rateLimits'))
  if (!directSource) return []

  const windows: CodexUsageWindow[] = []
  const primary = parseWindow('primary', firstValue(directSource, 'primary_window', 'primary'))
  const secondary = parseWindow('secondary', firstValue(directSource, 'secondary_window', 'secondary'))
  if (primary) windows.push(primary)
  if (secondary) windows.push(secondary)
  return windows
}

function hasRecognizedRateLimitFields(record: JsonRecord): boolean {
  return [
    'allowed',
    'limit_reached',
    'primary_window',
    'secondary_window',
    'primary',
    'secondary',
    'plan_type',
    'planType'
  ].some((key) => key in record)
}

export function parseCodexUsage(payload: unknown, email?: string): CodexQuotaData {
  const record = asRecord(payload) || {}
  const rateLimit = asRecord(firstValue(record, 'rate_limit', 'rateLimit'))
  const snapshot = findCodexSnapshot(firstValue(record, 'rateLimitsByLimitId', 'rateLimits'))
  const planType = asString(firstValue(record, 'plan_type', 'planType'))
    || (rateLimit ? asString(firstValue(rateLimit, 'plan_type', 'planType')) : undefined)
    || (snapshot ? asString(firstValue(snapshot, 'plan_type', 'planType')) : undefined)

  if ((rateLimit && !hasRecognizedRateLimitFields(rateLimit)) || (!planType && !rateLimit && !snapshot)) {
    return {
      configured: true,
      email,
      windows: [],
      error: 'Codex 额度返回格式异常'
    }
  }

  return {
    configured: true,
    planType,
    email,
    windows: snapshot || rateLimit ? parseWindows(record) : [],
    error: null
  }
}
