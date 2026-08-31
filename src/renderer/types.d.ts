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

export interface DeepSeekBalanceData {
  configured: boolean
  is_available?: boolean
  balance?: number
  currency?: string
  startBalance?: number
  usedPercent?: number
  error?: string | null
}

export interface PoolQuota {
  percent: number
  resetsAt: string | null
}

export interface GeminiQuotaData {
  configured: boolean
  email?: string
  geminiPool?: PoolQuota
  claudePool?: PoolQuota
  status?: string
  error?: string | null
}

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

export interface AppConfig {
  apiKey: string
  opencodeApiKey?: string
  deepseekApiKey?: string
  geminiRefreshToken?: string
  geminiAccountEmail?: string
  codexAuth?: {
    encrypted: string
  }
  alwaysOnTop: boolean
  clickThrough: boolean
  windowPosition?: { x: number; y: number }
  activePlanIndex?: number
  opacity?: number
  planName?: string
}

declare global {
  interface Window {
    electronAPI?: {
      getConfig: () => Promise<AppConfig>
      saveConfig: (config: Partial<AppConfig>) => Promise<AppConfig>
      fetchUsageNow: () => Promise<MultiPlanUsageData>
      getTodayStats: () => Promise<any>
      getCalendarStats: (year: number, month: number) => Promise<any>
      setOverlay: (mode: 'main' | 'settings' | 'calendar') => Promise<void>
      concealWindow: () => Promise<void>
      prepareOverlay: (mode: 'main' | 'calendar') => Promise<void>
      revealOverlay: () => Promise<void>
      startGoogleOAuth: () => Promise<{ success: boolean; email?: string; error?: string }>
      logoutGoogleOAuth: () => Promise<{ success: boolean }>
      getCodexAuthStatus: () => Promise<{ configured: boolean; email?: string; error?: string }>
      startCodexOAuth: () => Promise<{ success: boolean; email?: string; error?: string }>
      logoutCodexOAuth: () => Promise<{ success: boolean; error?: string }>
      openSettingsWindow: () => void
      openCalendarWindow: () => void
      closeCurrentWindow: () => void
      setAlwaysOnTop: (flag: boolean) => Promise<void>
      setOpacity: (val: number) => Promise<void>
      setIgnoreMouseEvents: (ignore: boolean) => Promise<void>
      minimizeWindow: () => void
      closeWindow: () => void
      onOpenOverlay?: (callback: (mode: 'settings' | 'calendar') => void) => () => void
      onClickThroughChanged: (callback: (val: boolean) => void) => () => void
      onUsageUpdate: (callback: (data: MultiPlanUsageData) => void) => () => void
    }
  }
}
