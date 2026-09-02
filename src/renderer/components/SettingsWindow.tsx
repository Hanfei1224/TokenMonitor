import React, { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Bot,
  Check,
  ExternalLink,
  Key,
  Loader2,
  LogIn,
  Pencil,
  Plus,
  Settings,
  ShieldCheck,
  Trash2,
  X
} from 'lucide-react'
import { popupAnimate, popupInitial, popupSpring, usePopupEnter } from '../popupMotion.js'
import { AccountState, AccountSummary, ProviderId } from '../types.js'

interface SettingsWindowProps {
  onClose: () => void
  initialTab?: ProviderId
}

const API_TABS: ProviderId[] = ['opencode', 'deepseek']

function isApiTab(tab: ProviderId): tab is 'opencode' | 'deepseek' {
  return API_TABS.includes(tab)
}

function accountDisplayName(account: AccountSummary): string {
  return account.name || account.email || '未命名账号'
}

export const SettingsWindow: React.FC<SettingsWindowProps> = ({ onClose, initialTab = 'opencode' }) => {
  const [activeTab, setActiveTab] = useState<ProviderId>(initialTab)
  const [accountState, setAccountState] = useState<AccountState | null>(null)
  const [apiName, setApiName] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [showApiForm, setShowApiForm] = useState(false)
  const [editingApiId, setEditingApiId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [isSavingApi, setIsSavingApi] = useState(false)
  const [isLoggingInGoogle, setIsLoggingInGoogle] = useState(false)
  const [isLoggingInCodex, setIsLoggingInCodex] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const enter = usePopupEnter()

  const reloadData = async () => {
    if (!window.electronAPI) return
    setAccountState(await window.electronAPI.getAccountState())
  }

  useEffect(() => {
    void reloadData()
  }, [])

  useEffect(() => {
    setActiveTab(initialTab)
  }, [initialTab])

  useEffect(() => {
    setError(null)
    setEditingApiId(null)
    setShowApiForm(false)
    setApiName('')
    setApiKey('')
    setRenamingId(null)
  }, [activeTab])

  const accounts = accountState?.accounts[activeTab] || []

  const handleApiSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!window.electronAPI || !isApiTab(activeTab)) return
    setIsSavingApi(true)
    setError(null)
    try {
      const nextState = await window.electronAPI.saveApiAccount(
        activeTab,
        apiName,
        apiKey,
        editingApiId || undefined
      )
      setAccountState(nextState)
      setEditingApiId(null)
      setShowApiForm(false)
      setApiName('')
      setApiKey('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'API 保存失败')
    } finally {
      setIsSavingApi(false)
    }
  }

  const beginApiEdit = (account: AccountSummary) => {
    setEditingApiId(account.id)
    setShowApiForm(true)
    setApiName(account.name || '')
    setApiKey('')
    setError(null)
  }

  const beginRename = (account: AccountSummary) => {
    setRenamingId(account.id)
    setRenameValue(account.name || '')
    setError(null)
  }

  const handleRename = async (accountId: string) => {
    if (!window.electronAPI) return
    setError(null)
    try {
      setAccountState(await window.electronAPI.renameAccount(activeTab, accountId, renameValue))
      setRenamingId(null)
      setRenameValue('')
    } catch (err) {
      setError(err instanceof Error ? err.message : '名称保存失败')
    }
  }

  const handleDelete = async (account: AccountSummary) => {
    if (!window.electronAPI) return
    const label = accountDisplayName(account)
    if (!window.confirm(`确定删除“${label}”吗？`)) return
    setError(null)
    try {
      setAccountState(await window.electronAPI.deleteAccount(activeTab, account.id))
      if (editingApiId === account.id) {
        setEditingApiId(null)
        setApiName('')
        setApiKey('')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败')
    }
  }

  const handleGoogleLogin = async () => {
    if (!window.electronAPI || isLoggingInGoogle) return
    setIsLoggingInGoogle(true)
    setError(null)
    try {
      const result = await window.electronAPI.startGoogleOAuth()
      if (!result.success) throw new Error(result.error || 'Google 登录失败')
      await reloadData()
      if (result.accountId) {
        setRenamingId(result.accountId)
        setRenameValue('')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google 登录失败')
    } finally {
      setIsLoggingInGoogle(false)
    }
  }

  const handleCodexLogin = async () => {
    if (!window.electronAPI || isLoggingInCodex) return
    setIsLoggingInCodex(true)
    setError(null)
    try {
      const result = await window.electronAPI.startCodexOAuth()
      if (!result.success) throw new Error(result.error || 'ChatGPT 登录失败')
      await reloadData()
      if (result.accountId) {
        setRenamingId(result.accountId)
        setRenameValue('')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ChatGPT 登录失败')
    } finally {
      setIsLoggingInCodex(false)
    }
  }

  const providerLabel: Record<ProviderId, string> = {
    opencode: 'OpenCode',
    deepseek: 'DeepSeek',
    gemini: 'Gemini',
    codex: 'GPT'
  }

  const renderAccount = (account: AccountSummary) => {
    const isRenaming = renamingId === account.id
    return (
      <div key={account.id} className="flex items-center gap-2 rounded-xl bg-white/[0.05] border border-white/10 px-2.5 py-1.5">
        <div className="min-w-0 flex-1">
          {isRenaming ? (
            <input
              autoFocus
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void handleRename(account.id)
                if (event.key === 'Escape') setRenamingId(null)
              }}
              placeholder={account.kind === 'api' ? '请输入 API 名称' : '名称（可留空）'}
              className="w-full rounded-lg bg-white/10 border border-white/15 px-2 py-1 text-xs text-white placeholder-white/30 focus:outline-none focus:border-blue-400"
            />
          ) : (
            <>
              <div className="truncate text-xs font-medium text-white/90">{accountDisplayName(account)}</div>
              {account.kind === 'oauth' && account.name && account.email && (
                <div className="truncate text-[10px] text-white/45">{account.email}</div>
              )}
              {account.kind === 'api' && <div className="text-[10px] text-white/35">API Key 已保存</div>}
            </>
          )}
        </div>

        {isRenaming ? (
          <>
            <button
              onClick={() => void handleRename(account.id)}
              title="保存名称"
              className="rounded-lg p-1 text-emerald-300 hover:bg-emerald-500/15"
            >
              <Check className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setRenamingId(null)}
              title="取消"
              className="rounded-lg p-1 text-white/50 hover:bg-white/10 hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => beginRename(account)}
              title="重命名"
              className="rounded-lg p-1 text-white/45 hover:bg-white/10 hover:text-white"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            {account.kind === 'api' && (
              <button
                onClick={() => beginApiEdit(account)}
                title="编辑 API"
                className="rounded-lg p-1 text-white/45 hover:bg-white/10 hover:text-white"
              >
                <Key className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              onClick={() => void handleDelete(account)}
              title="删除"
              className="rounded-lg p-1 text-rose-300/70 hover:bg-rose-500/15 hover:text-rose-300"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>
    )
  }

  const renderApiTab = () => (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-white/80 font-medium">
          <Key className={activeTab === 'opencode' ? 'h-3.5 w-3.5 text-blue-400' : 'h-3.5 w-3.5 text-cyan-400'} />
          <span>{providerLabel[activeTab]} API</span>
        </div>
        <span className="text-[10px] text-white/40">{accounts.length} 个配置</span>
      </div>

      <div className="flex max-h-[92px] flex-col gap-1 overflow-y-auto pr-0.5">
        {accounts.length > 0 ? accounts.map(renderAccount) : (
          <div className="rounded-xl border border-dashed border-white/15 px-3 py-3 text-center text-[11px] text-white/35">
            暂无 API 配置
          </div>
        )}
      </div>

      {showApiForm ? (
        <form onSubmit={(event) => void handleApiSubmit(event)} className="flex flex-col gap-1.5 rounded-xl bg-white/[0.04] border border-white/10 p-2">
          <input
            required
            value={apiName}
            onChange={(event) => setApiName(event.target.value)}
            placeholder="API 名称（必填）"
            className="w-full rounded-lg bg-white/10 border border-white/15 px-2.5 py-1.5 text-xs text-white placeholder-white/30 focus:outline-none focus:border-blue-400"
          />
          <input
            type="password"
            required={!editingApiId}
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={editingApiId ? '留空保持原 API Key' : 'API Key（必填）'}
            className="w-full rounded-lg bg-white/10 border border-white/15 px-2.5 py-1.5 text-xs text-white placeholder-white/30 focus:outline-none focus:border-blue-400"
          />
          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => {
                setEditingApiId(null)
                setShowApiForm(false)
                setApiName('')
                setApiKey('')
              }}
              className="rounded-lg px-2.5 py-1 text-[10px] text-white/55 hover:bg-white/10 hover:text-white"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={isSavingApi}
              className="flex items-center gap-1 rounded-lg bg-blue-500/80 px-2.5 py-1 text-[10px] font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {isSavingApi ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
              保存
            </button>
          </div>
        </form>
      ) : (
        <button
          onClick={() => {
            setEditingApiId(null)
            setShowApiForm(true)
            setApiName('')
            setApiKey('')
          }}
          className="flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-white/20 py-1.5 text-[11px] text-white/60 hover:border-blue-400/50 hover:bg-blue-500/10 hover:text-blue-200"
        >
          <Plus className="h-3.5 w-3.5" />
          添加 {providerLabel[activeTab]} API
        </button>
      )}
    </div>
  )

  const renderOAuthTab = (provider: 'gemini' | 'codex') => {
    const isGemini = provider === 'gemini'
    const loggingIn = isGemini ? isLoggingInGoogle : isLoggingInCodex
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-white/80 font-medium">
            {isGemini ? <ShieldCheck className="h-3.5 w-3.5 text-purple-400" /> : <Bot className="h-3.5 w-3.5 text-emerald-400" />}
            <span>{isGemini ? 'Google OAuth 账号' : 'ChatGPT OAuth 账号'}</span>
          </div>
          <span className="text-[10px] text-white/40">{accounts.length} 个账号</span>
        </div>

        <div className="flex max-h-[92px] flex-col gap-1 overflow-y-auto pr-0.5">
          {accounts.length > 0 ? accounts.map(renderAccount) : (
            <div className="rounded-xl border border-dashed border-white/15 px-3 py-3 text-center text-[11px] text-white/35">
              暂无账号
            </div>
          )}
        </div>

        <button
          onClick={() => void (isGemini ? handleGoogleLogin() : handleCodexLogin())}
          disabled={loggingIn}
          className={`flex w-full items-center justify-center gap-2 rounded-xl py-2 text-xs font-medium text-white transition-all disabled:opacity-60 ${
            isGemini ? 'bg-purple-600 hover:bg-purple-500 shadow-lg shadow-purple-600/30' : 'bg-emerald-600 hover:bg-emerald-500 shadow-lg shadow-emerald-600/30'
          }`}
        >
          {loggingIn ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
          {loggingIn ? '正在打开浏览器等待登录...' : `添加 ${isGemini ? 'Google' : 'ChatGPT'} 账号`}
        </button>

        <div className="flex items-center gap-1 text-[10px] text-white/35">
          <ExternalLink className="h-3 w-3" />
          <span>{isGemini ? 'OAuth 登录完成后可选填账号名称' : 'refresh token 使用系统安全存储加密保存'}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full h-screen p-2 flex flex-col box-border font-sans select-none overflow-hidden">
      <motion.div
        initial={popupInitial}
        animate={enter ? popupAnimate : popupInitial}
        transition={enter ? popupSpring : { duration: 0 }}
        className="glass-panel-pure w-full h-full rounded-[22px] p-4 shadow-2xl flex flex-col text-white border border-white/20 relative"
        style={{ willChange: enter ? 'transform, opacity' : 'auto' }}
      >
        <div className="app-drag-region flex items-center justify-between pb-2 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2">
            <Settings className="h-4 w-4 text-blue-400" />
            <h3 className="text-sm font-semibold tracking-wide text-white/90">多通道设置</h3>
          </div>

          <div className="app-no-drag flex items-center gap-1 bg-white/10 p-0.5 rounded-xl border border-white/10">
            {(['opencode', 'deepseek', 'gemini', 'codex'] as ProviderId[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-2.5 py-0.5 rounded-lg text-[11px] font-medium transition-all ${
                  activeTab === tab
                    ? tab === 'opencode' ? 'bg-blue-500 text-white shadow-sm'
                      : tab === 'deepseek' ? 'bg-cyan-500 text-white shadow-sm'
                        : tab === 'gemini' ? 'bg-purple-500 text-white shadow-sm'
                          : 'bg-emerald-500 text-white shadow-sm'
                    : 'text-white/60 hover:text-white'
                }`}
              >
                {providerLabel[tab]}
              </button>
            ))}
          </div>

          <button
            onClick={onClose}
            className="app-no-drag glass-button-pure p-1 rounded-full text-white/60 hover:text-rose-400"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="app-no-drag flex-1 min-h-0 flex flex-col justify-start gap-2 overflow-y-auto text-xs px-1 py-2">
          {isApiTab(activeTab) ? renderApiTab() : renderOAuthTab(activeTab)}
          {error && <div className="text-[10px] text-rose-400/85">{error}</div>}
        </div>

        <div className="app-no-drag flex justify-end pt-2 border-t border-white/10 shrink-0">
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-xl text-white/60 hover:text-white text-xs hover:bg-white/10 transition-all"
          >
            完成
          </button>
        </div>
      </motion.div>
    </div>
  )
}
