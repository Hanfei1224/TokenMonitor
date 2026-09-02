import { fetchDeepSeekBalance, DeepSeekBalanceData } from './deepseek.js'
import { fetchGeminiQuota, GeminiQuotaData } from './geminiAuth.js'
import { fetchCodexQuotaForAccount } from './codexAuth.js'
import { CodexQuotaData } from './codexUsage.js'
import { AppConfig, getActiveAccount, ProviderAccount, ProviderId } from './store.js'

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

export type AccountUsageValue = OpenCodeUsageData | DeepSeekBalanceData | GeminiQuotaData | CodexQuotaData
export type AccountUsageProgress = (provider: ProviderId, accountId: string, usage: AccountUsageValue) => void

const OPENCODE_URL = 'https://opencode.ai/zen/go/v1/usage'

function accountMeta(account: ProviderAccount | undefined): { accountId?: string; accountName?: string } {
  if (!account) return {}
  return {
    accountId: account.id,
    accountName: 'apiKey' in account ? account.name : account.name || account.email
  }
}

function accountApiKey(account: ProviderAccount | undefined): string {
  return account && 'apiKey' in account ? account.apiKey : ''
}

function accountRefreshToken(account: ProviderAccount | undefined): string {
  return account && 'refreshToken' in account ? account.refreshToken : ''
}

function accountEmail(account: ProviderAccount | undefined): string | undefined {
  return account && 'email' in account ? account.email : undefined
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new Error('请求已取消')
}

async function readJson<T>(response: Response, signal?: AbortSignal): Promise<T> {
  throwIfAborted(signal)
  const data = await response.json() as T
  throwIfAborted(signal)
  return data
}

async function fetchAccountUsages<T>(
  accounts: ProviderAccount[],
  fetcher: (account: ProviderAccount) => Promise<T>,
  onAccount?: (accountId: string, usage: T) => void
): Promise<Record<string, T>> {
  const entries: Array<readonly [string, T]> = []
  let nextIndex = 0
  const worker = async () => {
    while (true) {
      const index = nextIndex++
      if (index >= accounts.length) return
      const account = accounts[index]
      const usage = await fetcher(account)
      entries[index] = [account.id, usage]
      onAccount?.(account.id, usage)
    }
  }
  await Promise.all(Array.from({ length: Math.min(5, accounts.length) }, () => worker()))
  return Object.fromEntries(entries)
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
  signal?: AbortSignal,
  onAccountUsage?: AccountUsageProgress
): Promise<MultiPlanUsageData> {
  throwIfAborted(signal)
  const t0 = Date.now()

  const opencodeAccounts = cfg.opencodeAccounts || []
  const deepseekAccounts = cfg.deepseekAccounts || []
  const geminiAccounts = cfg.geminiAccounts || []
  const codexAccounts = cfg.codexAccounts || []

  const [opencodeByAccount, deepseekByAccount, geminiByAccount, codexByAccount] = await Promise.all([
    fetchAccountUsages(opencodeAccounts, (account) =>
      fetchOpenCodeUsage(accountApiKey(account), signal)
        .then((data) => ({ ...data, ...accountMeta(account) })),
      (accountId, usage) => onAccountUsage?.('opencode', accountId, usage)
    ),
    fetchAccountUsages(deepseekAccounts, (account) =>
      fetchDeepSeekBalance(accountApiKey(account), signal, account.id)
        .then((data) => ({ ...data, ...accountMeta(account) })),
      (accountId, usage) => onAccountUsage?.('deepseek', accountId, usage)
    ),
    fetchAccountUsages(geminiAccounts, (account) =>
      fetchGeminiQuota(
        accountRefreshToken(account),
        accountEmail(account),
        signal
      ).then((data) => ({ ...data, ...accountMeta(account) })),
      (accountId, usage) => onAccountUsage?.('gemini', accountId, usage)
    ),
    fetchAccountUsages(codexAccounts, (account) =>
      ('encrypted' in account
        ? fetchCodexQuotaForAccount(account.encrypted, account.id, signal)
        : Promise.resolve({ configured: false, error: 'ChatGPT 账号凭证格式无效' }))
        .then((data) => ({ ...data, ...accountMeta(account) })),
      (accountId, usage) => onAccountUsage?.('codex', accountId, usage)
    )
  ])

  const opencodeAccount = getActiveAccount(cfg, 'opencode')
  const deepseekAccount = getActiveAccount(cfg, 'deepseek')
  const geminiAccount = getActiveAccount(cfg, 'gemini')
  const codexAccount = getActiveAccount(cfg, 'codex')
  const opencode = opencodeAccount ? opencodeByAccount[opencodeAccount.id] : { configured: false }
  const deepseek = deepseekAccount ? deepseekByAccount[deepseekAccount.id] : { configured: false }
  const gemini = geminiAccount ? geminiByAccount[geminiAccount.id] : { configured: false }
  const codex = codexAccount ? codexByAccount[codexAccount.id] : { configured: false }

  throwIfAborted(signal)
  const latency = Date.now() - t0

  // 检查是否至少配置了一个通道
  const hasAnyConfigured = [
    ...Object.values(opencodeByAccount),
    ...Object.values(deepseekByAccount),
    ...Object.values(geminiByAccount),
    ...Object.values(codexByAccount)
  ].some((value) => value.configured)
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
    accountUsage: {
      opencode: opencodeByAccount,
      deepseek: deepseekByAccount,
      gemini: geminiByAccount,
      codex: codexByAccount
    },
    todayStats,
    last_refresh: new Date().toLocaleTimeString(),
    latency_ms: latency,
    error: globalError
  }
}
