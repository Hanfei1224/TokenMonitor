import { fetchDeepSeekBalance, DeepSeekBalanceData } from './deepseek.js'
import { fetchGeminiQuota, GeminiQuotaData } from './geminiAuth.js'
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
  todayStats?: any
  last_refresh?: string
  latency_ms?: number
  error?: string | null
}

const OPENCODE_URL = 'https://opencode.ai/zen/go/v1/usage'

export async function fetchOpenCodeUsage(apiKey?: string): Promise<OpenCodeUsageData> {
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
      }
    })

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        return { configured: true, error: 'API Key 无效或无权限' }
      }
      return { configured: true, error: `HTTP ${res.status}` }
    }

    const json = await res.json()
    return {
      configured: true,
      usage: json.usage || json,
      error: null
    }
  } catch (err: any) {
    return {
      configured: true,
      error: err.message || '网络异常'
    }
  }
}

export async function fetchMultiPlanUsage(cfg: AppConfig, todayStats?: any): Promise<MultiPlanUsageData> {
  const t0 = Date.now()

  const [opencode, deepseek, gemini] = await Promise.all([
    fetchOpenCodeUsage(cfg.opencodeApiKey || cfg.apiKey),
    fetchDeepSeekBalance(cfg.deepseekApiKey || ''),
    fetchGeminiQuota(cfg.geminiRefreshToken || '', cfg.geminiAccountEmail)
  ])

  const latency = Date.now() - t0

  // 检查是否至少配置了一个通道
  const hasAnyConfigured = opencode.configured || deepseek.configured || gemini.configured
  let globalError: string | null = null
  if (!hasAnyConfigured) {
    globalError = 'config_missing'
  }

  return {
    plan_name: '用量监控',
    opencode,
    deepseek,
    gemini,
    todayStats,
    last_refresh: new Date().toLocaleTimeString(),
    latency_ms: latency,
    error: globalError
  }
}
