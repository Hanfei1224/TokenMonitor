import type { JsonlParseContext, TokenStatsRow } from './statsScanner.js'

function stringValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

function modelFromPayload(payload: any): string | undefined {
  return [
    payload.info?.model,
    payload.model,
    payload.thread_settings?.model,
    payload.thread_settings?.collaboration_mode?.settings?.model,
    payload.collaboration_mode?.settings?.model,
    payload.state?.model,
    payload.state?.collaboration_mode?.model
  ].map(stringValue).find(Boolean)
}

function isoToMs(value: unknown): number {
  if (typeof value !== 'string') return 0
  const n = new Date(value.replace('Z', '+00:00')).getTime()
  return Number.isNaN(n) ? 0 : n
}

export function parseCodexStatsLine(line: string, context: JsonlParseContext): TokenStatsRow | null {
  if (!line.includes('"token_count"') && !line.includes('"model"')) return null

  try {
    const j = JSON.parse(line)
    const p = j.payload || {}
    const model = modelFromPayload(p)
    if (model) context.model = model
    if (p.type !== 'token_count') return null

    const u = p.info?.last_token_usage || {}
    const total = Number(u.total_tokens || 0)
    if (!total) return null
    const ts = isoToMs(j.timestamp)
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
      model: context.model || 'codex'
    }
  } catch {
    return null
  }
}
