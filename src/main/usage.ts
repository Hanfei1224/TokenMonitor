import { fetchDeepSeekBalance, DeepSeekBalanceData } from './deepseek.js'
import { fetchGeminiQuota, GeminiQuotaData } from './geminiAuth.js'
import { fetchCodexQuota } from './codexAuth.js'
import { CodexQuotaData } from './codexUsage.js'
import { AppConfig } from './store.js'

export interface UsageWindow {
  percent: number
  resetsAt: string | null
  current: number
  total: number
}

export interface OpenCodeUsageData {
  configured: boolean
  usage?: {
    rolling?: UsageWindow
    weekly?: UsageWindow
    monthly?: UsageWindow
  }
  error?: string | null
}

export interface MultiPlanUsageData {
  plan_name: string
  opencode: OpenCodeUsageData
  deepseek: DeepSeekBalanceData
  gemini: GeminiQuotaData
  codex: CodexQuotaData
  todayStats?: any
  last_refresh?: string
  latency_ms?: number
  error?: string | null
}

const OPENCODE_URL = 'https://opencode.ai/zen/go/v1/usage'

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new Error('请求已取消')
}

async function readJson<T>(response: Response, signal?: AbortSignal): Promise<T> {
  throwIfAborted(signal)
  const data = await response.json() as T
  throwIfAborted(signal)
  return data
}

export async function fetchOpenCodeUsage(apiKey?: string, signal?: AbortSignal): Promise<OpenCodeUsageData> {
  throwIfAborted(signal)
  if (!apiKey) {
    return { configured: false }
  }

  try {
    const res = await fetch(OPENCODE_URL, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'x-api-key': apiKey,
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
      },
      signal
    })

    throwIfAborted(signal)
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        return { configured: true, error: 'API Key 无效或无权限' }
      }
      return { configured: true, error: `HTTP ${res.status}` }
    }

    const json = await readJson<any>(res, signal)
    return {
      configured: true,
      usage: json.usage || json,
      error: null
    }
  } catch (err: unknown) {
    throwIfAborted(signal)
    return {
      configured: true,
      error: err instanceof Error && err.message ? err.message : '网络异常'
    }
  }
}

export async function fetchMultiPlanUsage(
  cfg: AppConfig,
  todayStats?: any,
  signal?: AbortSignal
): Promise<MultiPlanUsageData> {
  throwIfAborted(signal)
  const t0 = Date.now()

  const [opencode, deepseek, gemini, codex] = await Promise.all([
    fetchOpenCodeUsage(cfg.opencodeApiKey || cfg.apiKey, signal),
    fetchDeepSeekBalance(cfg.deepseekApiKey || '', signal),
    fetchGeminiQuota(cfg.geminiRefreshToken || '', cfg.geminiAccountEmail, signal),
    fetchCodexQuota(signal)
  ])

  throwIfAborted(signal)
  const latency = Date.now() - t0

  // 检查是否至少配置了一个通道
  const hasAnyConfigured = opencode.configured || deepseek.configured || gemini.configured || codex.configured
  let globalError: string | null = null
  if (!hasAnyConfigured) {
    globalError = 'config_missing'
  }

  return {
    plan_name: '用量监控',
    opencode,
    deepseek,
    gemini,
    codex,
    todayStats,
    last_refresh: new Date().toLocaleTimeString(),
    latency_ms: latency,
    error: globalError
  }
}
