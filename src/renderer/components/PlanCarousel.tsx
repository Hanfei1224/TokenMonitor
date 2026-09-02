import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Bot, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Key, Loader2, ShieldCheck } from 'lucide-react'
import { RingProgress } from './RingProgress.js'
import { AccountState, MultiPlanUsageData, ProviderId } from '../types.js'

interface PlanCarouselProps {
  data: MultiPlanUsageData | null
  onOpenSettings: (tab?: 'opencode' | 'deepseek' | 'gemini' | 'codex') => void
}

export const PlanCarousel: React.FC<PlanCarouselProps> = ({ data, onOpenSettings }) => {
  const [currentIndex, setCurrentIndex] = useState(3)
  const [accountState, setAccountState] = useState<AccountState | null>(null)
  const [isSwitchingAccount, setIsSwitchingAccount] = useState(false)

  const plans: Array<{ id: ProviderId; name: string }> = [
    {
      id: 'opencode',
      name: 'OpenCode Go'
    },
    {
      id: 'deepseek',
      name: 'DeepSeek 官方'
    },
    {
      id: 'gemini',
      name: 'Google Gemini'
    },
    {
      id: 'codex',
      name: 'OpenAI GPT'
    }
  ]

  // 初始化加载上次停留的页面索引
  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.getConfig().then((cfg) => {
        if (typeof cfg.activePlanIndex === 'number' && cfg.activePlanIndex >= 0 && cfg.activePlanIndex < plans.length) {
          setCurrentIndex(cfg.activePlanIndex)
        }
      })
      window.electronAPI.getAccountState().then(setAccountState)
    }
  }, [])

  const handleSwitchIndex = (nextIdx: number) => {
    setCurrentIndex(nextIdx)
    if (window.electronAPI) {
      window.electronAPI.saveConfig({ activePlanIndex: nextIdx })
    }
  }

  const handlePrev = (e: React.MouseEvent) => {
    e.stopPropagation()
    const next = currentIndex === 0 ? plans.length - 1 : currentIndex - 1
    handleSwitchIndex(next)
  }

  const handleNext = (e: React.MouseEvent) => {
    e.stopPropagation()
    const next = currentIndex === plans.length - 1 ? 0 : currentIndex + 1
    handleSwitchIndex(next)
  }

  const currentPlan = plans[currentIndex]
  const currentProvider = currentPlan.id
  const currentAccounts = accountState?.accounts[currentProvider] || []
  const currentProviderData = data?.[currentProvider]
  const selectedAccountId = accountState?.activeAccountIds[currentProvider]
    || currentProviderData?.accountId
    || currentAccounts[0]?.id
  const currentData = data?.accountUsage?.[currentProvider]?.[selectedAccountId || ''] || currentProviderData
  const selectedAccountIndex = currentAccounts.findIndex((account) => account.id === selectedAccountId)
  const selectedAccount = selectedAccountIndex >= 0 ? currentAccounts[selectedAccountIndex] : undefined
  const selectedAccountEmail = selectedAccount?.email || (currentData && 'email' in currentData ? currentData.email : undefined)
  const selectedAccountName = selectedAccount?.name || currentData?.accountName || selectedAccountEmail

  const handleAccountSwitch = async (direction: -1 | 1) => {
    if (!window.electronAPI || currentAccounts.length < 2 || isSwitchingAccount) return
    const currentIdx = selectedAccountIndex >= 0 ? selectedAccountIndex : 0
    const nextIdx = (currentIdx + direction + currentAccounts.length) % currentAccounts.length
    const nextAccount = currentAccounts[nextIdx]
    setIsSwitchingAccount(true)
    try {
      const nextState = await window.electronAPI.setActiveAccount(currentProvider, nextAccount.id)
      setAccountState(nextState)
    } catch (err) {
      console.error('切换账号失败:', err)
    } finally {
      setIsSwitchingAccount(false)
    }
  }

  const formatPlanType = (planType?: string) => {
    if (!planType) return 'ChatGPT'
    const labels: Record<string, string> = {
      plus: 'Plus',
      // WHAM uses `prolite` for Pro 5x and `pro` for Pro 20x.
      prolite: 'Pro 5x',
      pro: 'Pro 20x',
      team: 'Team',
      business: 'Business',
      enterprise: 'Enterprise',
      free: 'Free'
    }
    return labels[planType.toLowerCase()] || planType
  }

  const planBadgeClass = (planType?: string) => {
    switch (planType?.toLowerCase()) {
      case 'ultra': return 'text-fuchsia-300'
      case 'pro': return 'text-violet-300'
      case 'prolite': return 'text-sky-300'
      case 'plus': return 'text-emerald-300'
      case 'team': return 'text-amber-300'
      case 'business': return 'text-orange-300'
      case 'enterprise': return 'text-rose-300'
      case 'standard': return 'text-cyan-300'
      case 'free': return 'text-white/50'
      default: return 'text-white/50'
    }
  }

  const currentPlanName = currentPlan.name

  // 1. 渲染 OpenCode Go（统一为剩余百分比：100 - usedPercent）
  const renderOpenCode = () => {
    const opencode = data?.accountUsage?.opencode?.[selectedAccountId || ''] || data?.opencode
    if (!opencode?.configured) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-2 text-white/50">
          <Key className="w-6 h-6 text-blue-400/60" />
          <span className="text-[11px]">未配置 OpenCode Key</span>
          <button
            onClick={() => onOpenSettings('opencode')}
            className="px-2.5 py-0.5 rounded-lg bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 text-[10px] border border-blue-500/30 transition-all"
          >
            去配置
          </button>
        </div>
      )
    }

    if (opencode.error) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-1 text-rose-300/80 text-center px-2">
          <span className="text-xs font-semibold">连接异常</span>
          <span className="text-[10px] text-rose-400/60">{opencode.error}</span>
        </div>
      )
    }

    // 换算为剩余额度
    const rollingRemain = Math.max(0, 100 - (opencode.usage?.rolling?.percent ?? 0))
    const weeklyRemain = Math.max(0, 100 - (opencode.usage?.weekly?.percent ?? 0))
    const monthlyRemain = Math.max(0, 100 - (opencode.usage?.monthly?.percent ?? 0))

    return (
      <div className="flex items-center justify-between w-full h-full px-0.5">
        <RingProgress
          label="5H余额"
          percent={rollingRemain}
          resetsAt={opencode.usage?.rolling?.resetsAt}
        />
        <RingProgress
          label="本周余额"
          percent={weeklyRemain}
          resetsAt={opencode.usage?.weekly?.resetsAt}
        />
        <RingProgress
          label="本月余额"
          percent={monthlyRemain}
          resetsAt={opencode.usage?.monthly?.resetsAt}
        />
      </div>
    )
  }

  // 2. 渲染 DeepSeek（保持不变写今日消耗百分比）
  const renderDeepSeek = () => {
    const deepseek = data?.accountUsage?.deepseek?.[selectedAccountId || ''] || data?.deepseek
    if (!deepseek?.configured) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-2 text-white/50">
          <Key className="w-6 h-6 text-cyan-400/60" />
          <span className="text-[11px]">未配置 DeepSeek Key</span>
          <button
            onClick={() => onOpenSettings('deepseek')}
            className="px-2.5 py-0.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 text-[10px] border border-cyan-500/30 transition-all"
          >
            去配置
          </button>
        </div>
      )
    }

    if (deepseek.error) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-1 text-rose-300/80 text-center px-2">
          <span className="text-xs font-semibold">连接异常</span>
          <span className="text-[10px] text-rose-400/60">{deepseek.error}</span>
        </div>
      )
    }

    const usedPercent = deepseek.usedPercent ?? 0
    const balance = deepseek.balance !== undefined ? deepseek.balance.toFixed(2) : '--'
    const currency = deepseek.currency === 'CNY' ? '¥' : '$'

    return (
      <div className="flex items-center justify-around w-full h-full px-2">
        <RingProgress
          label="今日消耗"
          percent={usedPercent}
          subText={`基准 ${currency}${deepseek.startBalance?.toFixed(2) ?? balance}`}
        />

        <div className="flex flex-col justify-center gap-1 pl-2">
          <span className="text-[11px] text-white/50">当前可用余额</span>
          <span className="text-2xl font-bold text-white tracking-tight tabular-nums flex items-baseline gap-1">
            <span className="text-sm font-semibold text-cyan-400">{currency}</span>
            {balance}
          </span>
          <span className="text-[10px] text-white/40">
            官方账户实时同步
          </span>
        </div>
      </div>
    )
  }

  // 3. 渲染 Google Gemini（Gemini 剩余 + Claude 剩余双池子）
  const renderGemini = () => {
    const gemini = data?.accountUsage?.gemini?.[selectedAccountId || ''] || data?.gemini
    if (!gemini?.configured) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-2 text-white/50">
          <ShieldCheck className="w-6 h-6 text-purple-400/60" />
          <span className="text-[11px]">未绑定 Google 账号</span>
          <button
            onClick={() => onOpenSettings('gemini')}
            className="px-2.5 py-0.5 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 text-[10px] border border-purple-500/30 transition-all"
          >
            去登录
          </button>
        </div>
      )
    }

    if (gemini.error) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-1 text-rose-300/80 text-center px-2">
          <span className="text-xs font-semibold">Gemini 状态异常</span>
          <span className="text-[10px] text-rose-400/60">{gemini.error}</span>
        </div>
      )
    }

    return (
      <div className="flex flex-col w-full h-full justify-between py-0.5">
        {/* 两个统一标准尺寸圆环：Gemini 剩余 + Claude 剩余 */}
        <div className="flex items-center justify-around w-full">
          <RingProgress
            label="Gemini 剩余"
            percent={gemini.geminiPool?.percent ?? 100}
            resetsAt={gemini.geminiPool?.resetsAt}
          />
          <RingProgress
            label="Claude 剩余"
            percent={gemini.claudePool?.percent ?? 100}
            resetsAt={gemini.claudePool?.resetsAt}
          />
        </div>

      </div>
    )
  }

  // 4. 渲染 Codex（只展示接口实际返回的窗口）
  const renderCodex = () => {
    const codex = data?.accountUsage?.codex?.[selectedAccountId || ''] || data?.codex
    if (!codex?.configured) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-2 text-white/50">
          <Bot className="w-6 h-6 text-emerald-400/60" />
          <span className="text-[11px]">未登录 ChatGPT 账号</span>
          <button
            onClick={() => onOpenSettings('codex')}
            className="px-2.5 py-0.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 text-[10px] border border-emerald-500/30 transition-all"
          >
            去登录
          </button>
        </div>
      )
    }

    if (codex.error) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-1 text-rose-300/80 text-center px-2">
          <span className="text-xs font-semibold">GPT 状态异常</span>
          <span className="text-[10px] text-rose-400/60">{codex.error}</span>
          <button
            onClick={() => onOpenSettings('codex')}
            className="mt-1 px-2.5 py-0.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 text-[10px] border border-emerald-500/30 transition-all"
          >
            重新登录
          </button>
        </div>
      )
    }

    const windows = codex.windows || []
    return (
      <div className="flex flex-col w-full h-full justify-center py-0.5">
        {windows.length > 0 ? (
          <div className="flex items-center justify-around w-full">
            {windows.map((window) => (
              <RingProgress
                key={window.id}
                label={window.label}
                percent={window.percent}
                resetsAt={window.resetsAt}
              />
            ))}
          </div>
        ) : (
          <div className="text-center text-[11px] text-white/50">当前账号暂无额度窗口</div>
        )}
      </div>
    )
  }

  return (
    <div className="relative flex flex-col flex-1 h-[142px] overflow-hidden group px-1">
      {/* 顶部指示标头：左侧名称 + 右上角滚动指示小点 */}
      <div className="flex items-center justify-between pb-1 px-0.5 shrink-0">
        <span className="text-[11px] font-medium text-white/70 tracking-wide">
          {currentPlanName}
        </span>
        {/* 右上角指示小点 */}
        <div className="flex items-center gap-1.5">
          {plans.map((p, idx) => (
            <button
              key={p.id}
              onClick={() => handleSwitchIndex(idx)}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                idx === currentIndex ? 'w-3.5 bg-white/90' : 'w-1.5 bg-white/25 hover:bg-white/50'
              }`}
            />
          ))}
        </div>
        </div>

      <div className="flex h-5 items-center justify-center gap-1 shrink-0 text-[10px] text-white/65">
        {selectedAccountName && (
          <>
          {currentProvider === 'gemini' && (data?.accountUsage?.gemini?.[selectedAccountId || ''] || data?.gemini)?.planType && (
            <span className={`shrink-0 font-semibold ${planBadgeClass((data?.accountUsage?.gemini?.[selectedAccountId || ''] || data?.gemini)?.planType)}`}>
              {(data?.accountUsage?.gemini?.[selectedAccountId || ''] || data?.gemini)?.planType}
            </span>
          )}
          {currentProvider === 'codex' && (
            <span className={`shrink-0 font-semibold ${planBadgeClass((data?.accountUsage?.codex?.[selectedAccountId || ''] || data?.codex)?.planType)}`}>
              {formatPlanType((data?.accountUsage?.codex?.[selectedAccountId || ''] || data?.codex)?.planType)}
            </span>
          )}
          {currentAccounts.length > 1 && (
            <button
              onClick={() => void handleAccountSwitch(-1)}
              disabled={isSwitchingAccount}
              title="上一个账号 / API"
              className="rounded-md p-0.5 text-white/50 hover:bg-white/10 hover:text-white hover:drop-shadow-[0_0_6px_rgba(255,255,255,0.7)] disabled:opacity-40"
            >
              <ChevronUp className="h-3.5 w-3.5" />
            </button>
          )}
          <span className="flex max-w-[165px] min-w-0 items-baseline truncate" title={selectedAccountEmail || selectedAccountName}>
            <span className="truncate">{selectedAccountName}</span>
            {selectedAccountEmail && selectedAccountName !== selectedAccountEmail && (
              <span className="ml-1 max-w-[90px] truncate text-white/35">({selectedAccountEmail})</span>
            )}
            {currentAccounts.length > 1 && ` ${Math.max(1, selectedAccountIndex + 1)}/${currentAccounts.length}`}
          </span>
          {currentAccounts.length > 1 && (
            <button
              onClick={() => void handleAccountSwitch(1)}
              disabled={isSwitchingAccount}
              title="下一个账号 / API"
              className="rounded-md p-0.5 text-white/50 hover:bg-white/10 hover:text-white hover:drop-shadow-[0_0_6px_rgba(255,255,255,0.7)] disabled:opacity-40"
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
          )}
          {isSwitchingAccount && <Loader2 className="h-3 w-3 animate-spin text-blue-300" />}
          </>
        )}
        </div>

      {/* 主展示区 */}
      <div className="relative flex-1 min-h-0 flex items-center justify-center">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentPlan.id}
            initial={{ opacity: 0, x: 14 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -14 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
            className="w-full h-full flex items-center justify-center"
          >
            {currentIndex === 0 && renderOpenCode()}
            {currentIndex === 1 && renderDeepSeek()}
            {currentIndex === 2 && renderGemini()}
            {currentIndex === 3 && renderCodex()}
          </motion.div>
        </AnimatePresence>

        {/* 左右切页箭头 */}
        <button
          onClick={handlePrev}
          title="上一页"
          className="absolute -left-1 top-1/2 h-6 w-6 -translate-y-1/2 flex items-center justify-center p-0 rounded-full text-white/50 hover:bg-white/10 hover:text-white hover:drop-shadow-[0_0_6px_rgba(255,255,255,0.7)] opacity-0 group-hover:opacity-100 transition-opacity z-10"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={handleNext}
          title="下一页"
          className="absolute -right-1 top-1/2 h-6 w-6 -translate-y-1/2 flex items-center justify-center p-0 rounded-full text-white/50 hover:bg-white/10 hover:text-white hover:drop-shadow-[0_0_6px_rgba(255,255,255,0.7)] opacity-0 group-hover:opacity-100 transition-opacity z-10"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}
