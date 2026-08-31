import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Bot, ChevronLeft, ChevronRight, Key, ShieldCheck } from 'lucide-react'
import { RingProgress } from './RingProgress.js'
import { MultiPlanUsageData } from '../types.js'

interface PlanCarouselProps {
  data: MultiPlanUsageData | null
  onOpenSettings: (tab?: 'opencode' | 'deepseek' | 'gemini' | 'codex') => void
}

export const PlanCarousel: React.FC<PlanCarouselProps> = ({ data, onOpenSettings }) => {
  const [currentIndex, setCurrentIndex] = useState(3)

  const plans = [
    {
      id: 'opencode',
      name: 'OpenCode Go',
      type: 'rolling'
    },
    {
      id: 'deepseek',
      name: 'DeepSeek 官方',
      type: 'balance'
    },
    {
      id: 'gemini',
      name: 'Gemini Pro (Google)',
      type: 'oauth'
    },
    {
      id: 'codex',
      name: 'GPT',
      type: 'oauth'
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

  const formatPlanType = (planType?: string) => {
    if (!planType) return 'ChatGPT'
    const labels: Record<string, string> = {
      plus: 'Plus',
      pro: 'Pro',
      prolite: 'Pro Lite',
      team: 'Team',
      business: 'Business',
      enterprise: 'Enterprise',
      free: 'Free'
    }
    return labels[planType.toLowerCase()] || planType
  }

  const currentPlanName = currentPlan.name

  // 1. 渲染 OpenCode Go（统一为剩余百分比：100 - usedPercent）
  const renderOpenCode = () => {
    const opencode = data?.opencode
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
    const deepseek = data?.deepseek
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

  // 3. 渲染 Gemini Pro（Gemini 剩余 + Claude 剩余双池子，完整展示重置时间与邮箱）
  const renderGemini = () => {
    const gemini = data?.gemini
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

        {/* 底部绑定邮箱（自然换行、给足空间） */}
        <div className="w-full text-center px-1">
          <span className="text-[10px] text-purple-200/70 break-all leading-tight">
            {gemini.email || '已绑定 Google 账号'}
          </span>
        </div>
      </div>
    )
  }

  // 4. 渲染 Codex（只展示接口实际返回的窗口）
  const renderCodex = () => {
    const codex = data?.codex
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
      <div className="flex flex-col w-full h-full justify-between py-0.5">
        <div className="flex items-center justify-between px-1 text-[10px]">
          <span className="text-emerald-400 font-semibold">{formatPlanType(codex.planType)}</span>
          <span className="text-white/40 truncate max-w-[150px]">{codex.email || 'ChatGPT 账号'}</span>
        </div>
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
          className="absolute -left-1 top-1/2 -translate-y-1/2 p-1 rounded-full glass-button-pure text-white/50 hover:text-white opacity-0 group-hover:opacity-100 transition-all z-10"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={handleNext}
          title="下一页"
          className="absolute -right-1 top-1/2 -translate-y-1/2 p-1 rounded-full glass-button-pure text-white/50 hover:text-white opacity-0 group-hover:opacity-100 transition-all z-10"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}
