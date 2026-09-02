export interface UsageWindow {
  percent: number
  resetsAt: string | null
  current: number
  total: number
}

export interface OpenCodeUsageData {
  configured: boolean
  accountId?: string
  accountName?: string
  usage?: {
    rolling?: UsageWindow
    weekly?: UsageWindow
    monthly?: UsageWindow
  }
  error?: string | null
}

export interface DeepSeekBalanceData {
  configured: boolean
  accountId?: string
  accountName?: string
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
  accountId?: string
  accountName?: string
  email?: string
  planType?: string
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
  accountId?: string
  accountName?: string
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
  accountUsage: AccountUsageData
  todayStats?: any
  last_refresh?: string
  latency_ms?: number
  error?: string | null
}

export interface AccountUsageData {
  opencode: Record<string, OpenCodeUsageData>
  deepseek: Record<string, DeepSeekBalanceData>
  gemini: Record<string, GeminiQuotaData>
  codex: Record<string, CodexQuotaData>
}

export interface AppConfig {
  apiKey?: string
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
  activeAccountIds?: Partial<Record<ProviderId, string>>
}

export type ProviderId = 'opencode' | 'deepseek' | 'gemini' | 'codex'

export interface AccountSummary {
  id: string
  name?: string
  email?: string
  kind: 'api' | 'oauth'
}

export interface AccountState {
  accounts: Record<ProviderId, AccountSummary[]>
  activeAccountIds: Partial<Record<ProviderId, string>>
}

declare global {
  interface Window {
    electronAPI?: {
      getConfig: () => Promise<AppConfig>
      saveConfig: (config: Partial<AppConfig>) => Promise<AppConfig>
      fetchUsageNow: () => Promise<MultiPlanUsageData>
      getTodayStats: () => Promise<any>
      getCalendarStats: (year: number, month: number) => Promise<any>
      getAccountState: () => Promise<AccountState>
      saveApiAccount: (provider: 'opencode' | 'deepseek', name: string, apiKey: string, accountId?: string) => Promise<AccountState>
      renameAccount: (provider: ProviderId, accountId: string, name: string) => Promise<AccountState>
      deleteAccount: (provider: ProviderId, accountId: string) => Promise<AccountState>
      setActiveAccount: (provider: ProviderId, accountId: string) => Promise<AccountState>
      setOverlay: (mode: 'main' | 'settings' | 'calendar') => Promise<void>
      concealWindow: () => Promise<void>
      prepareOverlay: (mode: 'main' | 'calendar') => Promise<void>
      revealOverlay: () => Promise<void>
      startGoogleOAuth: () => Promise<{ success: boolean; email?: string; accountId?: string; error?: string }>
      logoutGoogleOAuth: (accountId: string) => Promise<{ success: boolean; error?: string }>
      getCodexAuthStatus: () => Promise<{ configured: boolean; email?: string; error?: string }>
      startCodexOAuth: () => Promise<{ success: boolean; email?: string; accountId?: string; error?: string }>
      logoutCodexOAuth: (accountId?: string) => Promise<{ success: boolean; error?: string }>
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
      onUsageUpdate: (callback: (data: MultiPlanUsageData, complete?: boolean) => void) => () => void
    }
  }
}
