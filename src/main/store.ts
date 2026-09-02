import path from 'node:path'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { getLegacyDevStorageDir, getStorageDir } from './paths.js'

export type ProviderId = 'opencode' | 'deepseek' | 'gemini' | 'codex'
export type ApiProviderId = 'opencode' | 'deepseek'

export interface ApiAccount {
  id: string
  name: string
  apiKey: string
}

export interface GeminiAccount {
  id: string
  name?: string
  email?: string
  refreshToken: string
}

export interface CodexAccount {
  id: string
  name?: string
  email?: string
  encrypted: string
}

export type ProviderAccount = ApiAccount | GeminiAccount | CodexAccount

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

export interface AppConfig {
  // Legacy fields stay readable for upgrade compatibility. They mirror the selected account.
  apiKey: string
  opencodeApiKey?: string
  deepseekApiKey?: string
  geminiRefreshToken?: string
  geminiAccountEmail?: string
  codexAuth?: {
    encrypted: string
  }
  opencodeAccounts?: ApiAccount[]
  deepseekAccounts?: ApiAccount[]
  geminiAccounts?: GeminiAccount[]
  codexAccounts?: CodexAccount[]
  activeAccountIds?: Partial<Record<ProviderId, string>>
  alwaysOnTop: boolean
  clickThrough: boolean
  windowPosition?: { x: number; y: number }
  activePlanIndex?: number
}

const DEFAULT_CONFIG: AppConfig = {
  apiKey: '',
  opencodeApiKey: '',
  deepseekApiKey: '',
  geminiRefreshToken: '',
  geminiAccountEmail: '',
  opencodeAccounts: [],
  deepseekAccounts: [],
  geminiAccounts: [],
  codexAccounts: [],
  activeAccountIds: {},
  alwaysOnTop: true,
  clickThrough: false,
  activePlanIndex: 3
}

function getConfigPath(): string {
  return path.join(getStorageDir(), 'config.json')
}

function getLegacyConfigPath(): string | null {
  const legacyDir = getLegacyDevStorageDir()
  return legacyDir ? path.join(legacyDir, 'config.json') : null
}

function migrateLegacyConfig(configPath: string, legacyConfigPath: string | null): void {
  if (!legacyConfigPath || fs.existsSync(configPath) || !fs.existsSync(legacyConfigPath)) return
  try {
    fs.copyFileSync(legacyConfigPath, configPath)
  } catch (err) {
    console.error('Failed to migrate development config:', err)
  }
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function normalizeApiAccounts(value: unknown): ApiAccount[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map((item) => ({
      id: stringOrUndefined(item.id) || randomUUID(),
      name: stringOrUndefined(item.name) || 'API',
      apiKey: typeof item.apiKey === 'string' ? item.apiKey : ''
    }))
    .filter((item) => item.apiKey.length > 0)
}

function normalizeGeminiAccounts(value: unknown): GeminiAccount[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map((item) => ({
      id: stringOrUndefined(item.id) || randomUUID(),
      name: stringOrUndefined(item.name),
      email: stringOrUndefined(item.email),
      refreshToken: typeof item.refreshToken === 'string' ? item.refreshToken : ''
    }))
    .filter((item) => item.refreshToken.length > 0)
}

function normalizeCodexAccounts(value: unknown): CodexAccount[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map((item) => ({
      id: stringOrUndefined(item.id) || randomUUID(),
      name: stringOrUndefined(item.name),
      email: stringOrUndefined(item.email),
      encrypted: typeof item.encrypted === 'string' ? item.encrypted : ''
    }))
    .filter((item) => item.encrypted.length > 0)
}

function firstOrActive<T extends ProviderAccount>(accounts: T[], activeId?: string): T | undefined {
  return accounts.find((account) => account.id === activeId) || accounts[0]
}

function normalizeConfig(source: Record<string, unknown>): AppConfig {
  const merged = { ...DEFAULT_CONFIG, ...source } as AppConfig
  const raw = source

  if (hasOwn(raw, 'opencodeAccounts')) {
    merged.opencodeAccounts = normalizeApiAccounts(raw.opencodeAccounts)
  } else {
    const apiKey = typeof merged.opencodeApiKey === 'string' && merged.opencodeApiKey
      ? merged.opencodeApiKey
      : merged.apiKey
    merged.opencodeAccounts = apiKey
      ? [{ id: 'legacy-opencode', name: 'OpenCode API', apiKey }]
      : []
  }

  if (hasOwn(raw, 'deepseekAccounts')) {
    merged.deepseekAccounts = normalizeApiAccounts(raw.deepseekAccounts)
  } else {
    const apiKey = typeof merged.deepseekApiKey === 'string' ? merged.deepseekApiKey : ''
    merged.deepseekAccounts = apiKey
      ? [{ id: 'legacy-deepseek', name: 'DeepSeek API', apiKey }]
      : []
  }

  if (hasOwn(raw, 'geminiAccounts')) {
    merged.geminiAccounts = normalizeGeminiAccounts(raw.geminiAccounts)
  } else {
    const refreshToken = typeof merged.geminiRefreshToken === 'string' ? merged.geminiRefreshToken : ''
    merged.geminiAccounts = refreshToken
      ? [{ id: 'legacy-gemini', email: merged.geminiAccountEmail || undefined, refreshToken }]
      : []
  }

  if (hasOwn(raw, 'codexAccounts')) {
    merged.codexAccounts = normalizeCodexAccounts(raw.codexAccounts)
  } else {
    const encrypted = merged.codexAuth?.encrypted
    merged.codexAccounts = encrypted ? [{ id: 'legacy-codex', encrypted }] : []
  }

  const activeAccountIds: Partial<Record<ProviderId, string>> = {
    ...(merged.activeAccountIds || {})
  }
  const accountGroups: Record<ProviderId, ProviderAccount[]> = {
    opencode: merged.opencodeAccounts || [],
    deepseek: merged.deepseekAccounts || [],
    gemini: merged.geminiAccounts || [],
    codex: merged.codexAccounts || []
  }
  for (const provider of Object.keys(accountGroups) as ProviderId[]) {
    const active = firstOrActive(accountGroups[provider], activeAccountIds[provider])
    if (active) activeAccountIds[provider] = active.id
    else delete activeAccountIds[provider]
  }
  merged.activeAccountIds = activeAccountIds

  const opencode = firstOrActive(merged.opencodeAccounts, activeAccountIds.opencode)
  const deepseek = firstOrActive(merged.deepseekAccounts, activeAccountIds.deepseek)
  const gemini = firstOrActive(merged.geminiAccounts, activeAccountIds.gemini)
  const codex = firstOrActive(merged.codexAccounts, activeAccountIds.codex)
  merged.opencodeApiKey = opencode?.apiKey || ''
  merged.apiKey = merged.opencodeApiKey
  merged.deepseekApiKey = deepseek?.apiKey || ''
  merged.geminiRefreshToken = gemini?.refreshToken || ''
  merged.geminiAccountEmail = gemini?.email || ''
  merged.codexAuth = codex ? { encrypted: codex.encrypted } : undefined
  return merged
}

export function loadConfig(): AppConfig {
  const configPath = getConfigPath()
  const legacyConfigPath = getLegacyConfigPath()
  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    migrateLegacyConfig(configPath, legacyConfigPath)
    const sourcePath = fs.existsSync(configPath)
      ? configPath
      : legacyConfigPath && fs.existsSync(legacyConfigPath)
        ? legacyConfigPath
        : null
    if (sourcePath) {
      const data = fs.readFileSync(sourcePath, 'utf-8')
      const parsed = JSON.parse(data)
      return normalizeConfig(parsed && typeof parsed === 'object' ? parsed : {})
    }
  } catch (err) {
    console.error('Failed to load config:', err)
  }
  return normalizeConfig({})
}

export function saveConfig(cfg: Partial<AppConfig>): AppConfig {
  const configPath = getConfigPath()
  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    const current = loadConfig()
    const updated = normalizeConfig({ ...current, ...cfg } as Record<string, unknown>)
    fs.writeFileSync(configPath, JSON.stringify(updated, null, 2), 'utf-8')
    return updated
  } catch (err) {
    console.error('Failed to save config:', err)
    return loadConfig()
  }
}

function accountsFor(cfg: AppConfig, provider: ProviderId): ProviderAccount[] {
  if (provider === 'opencode') return cfg.opencodeAccounts || []
  if (provider === 'deepseek') return cfg.deepseekAccounts || []
  if (provider === 'gemini') return cfg.geminiAccounts || []
  return cfg.codexAccounts || []
}

export function getActiveAccount(cfg: AppConfig, provider: ProviderId): ProviderAccount | undefined {
  return firstOrActive(accountsFor(cfg, provider), cfg.activeAccountIds?.[provider])
}

function accountSummary(account: ProviderAccount): AccountSummary {
  if ('apiKey' in account) return { id: account.id, name: account.name, kind: 'api' }
  return { id: account.id, name: account.name, email: account.email, kind: 'oauth' }
}

export function getAccountState(): AccountState {
  const cfg = loadConfig()
  return {
    accounts: {
      opencode: (cfg.opencodeAccounts || []).map(accountSummary),
      deepseek: (cfg.deepseekAccounts || []).map(accountSummary),
      gemini: (cfg.geminiAccounts || []).map(accountSummary),
      codex: (cfg.codexAccounts || []).map(accountSummary)
    },
    activeAccountIds: { ...(cfg.activeAccountIds || {}) }
  }
}

function saveAccounts(provider: ProviderId, accounts: ProviderAccount[], activeAccountIds: Partial<Record<ProviderId, string>>): AccountState {
  const cfg: Partial<AppConfig> = { activeAccountIds }
  if (provider === 'opencode') cfg.opencodeAccounts = accounts as ApiAccount[]
  if (provider === 'deepseek') cfg.deepseekAccounts = accounts as ApiAccount[]
  if (provider === 'gemini') cfg.geminiAccounts = accounts as GeminiAccount[]
  if (provider === 'codex') cfg.codexAccounts = accounts as CodexAccount[]
  saveConfig(cfg)
  return getAccountState()
}

export function saveApiAccount(provider: ApiProviderId, name: string, apiKey: string, accountId?: string): AccountState {
  const trimmedName = name.trim()
  const trimmedKey = apiKey.trim()
  if (!trimmedName) throw new Error('API 名称不能为空')
  const cfg = loadConfig()
  const accounts = [...accountsFor(cfg, provider)] as ApiAccount[]
  if (accountId) {
    const index = accounts.findIndex((account) => account.id === accountId)
    if (index < 0) throw new Error('API 配置不存在')
    accounts[index] = { ...accounts[index], name: trimmedName, apiKey: trimmedKey || accounts[index].apiKey }
  } else {
    if (!trimmedKey) throw new Error('API Key 不能为空')
    accounts.push({ id: randomUUID(), name: trimmedName, apiKey: trimmedKey })
  }
  const activeAccountIds = { ...(cfg.activeAccountIds || {}) }
  if (!activeAccountIds[provider] || !accounts.some((account) => account.id === activeAccountIds[provider])) {
    activeAccountIds[provider] = accounts[0].id
  }
  return saveAccounts(provider, accounts, activeAccountIds)
}

export function addGeminiAccount(refreshToken: string, email?: string): AccountSummary {
  const cfg = loadConfig()
  const account: GeminiAccount = { id: randomUUID(), email: stringOrUndefined(email), refreshToken }
  const accounts = [...(cfg.geminiAccounts || []), account]
  saveAccounts('gemini', accounts, { ...(cfg.activeAccountIds || {}), gemini: account.id })
  return accountSummary(account)
}

export function addCodexAccount(encrypted: string, email?: string): AccountSummary {
  const cfg = loadConfig()
  const account: CodexAccount = { id: randomUUID(), email: stringOrUndefined(email), encrypted }
  const accounts = [...(cfg.codexAccounts || []), account]
  saveAccounts('codex', accounts, { ...(cfg.activeAccountIds || {}), codex: account.id })
  return accountSummary(account)
}

export function renameAccount(provider: ProviderId, accountId: string, name: string): AccountState {
  const trimmedName = name.trim()
  const cfg = loadConfig()
  const accounts = [...accountsFor(cfg, provider)]
  const index = accounts.findIndex((account) => account.id === accountId)
  if (index < 0) throw new Error('账号或 API 不存在')
  if (provider === 'opencode' || provider === 'deepseek') {
    if (!trimmedName) throw new Error('API 名称不能为空')
    accounts[index] = { ...(accounts[index] as ApiAccount), name: trimmedName } as ApiAccount
  } else {
    accounts[index] = { ...(accounts[index] as GeminiAccount | CodexAccount), name: trimmedName || undefined }
  }
  return saveAccounts(provider, accounts, { ...(cfg.activeAccountIds || {}) })
}

export function deleteAccount(provider: ProviderId, accountId: string): AccountState {
  const cfg = loadConfig()
  const original = accountsFor(cfg, provider)
  const accounts = original.filter((account) => account.id !== accountId)
  if (accounts.length === original.length) throw new Error('账号或 API 不存在')
  const activeAccountIds = { ...(cfg.activeAccountIds || {}) }
  if (activeAccountIds[provider] === accountId) {
    if (accounts[0]) activeAccountIds[provider] = accounts[0].id
    else delete activeAccountIds[provider]
  }
  return saveAccounts(provider, accounts, activeAccountIds)
}

export function setActiveAccount(provider: ProviderId, accountId: string): AccountState {
  const cfg = loadConfig()
  if (!accountsFor(cfg, provider).some((account) => account.id === accountId)) {
    throw new Error('账号或 API 不存在')
  }
  saveConfig({ activeAccountIds: { ...(cfg.activeAccountIds || {}), [provider]: accountId } })
  return getAccountState()
}
