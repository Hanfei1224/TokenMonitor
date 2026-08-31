import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Settings, BarChart2, Pin, MousePointer, Minus, X, Activity, AlertTriangle } from 'lucide-react'
import packageJson from '../package.json'
import { PlanCarousel } from './components/PlanCarousel.js'
import { TodayTokens } from './components/TodayTokens.js'
import { SettingsWindow } from './components/SettingsWindow.js'
import { CalendarWindow } from './components/CalendarWindow.js'

export default function App() {
  const urlParams = new URLSearchParams(window.location.search)
  const initialView = (urlParams.get('view') as 'main' | 'settings' | 'calendar') || 'main'

  const [view, setView] = useState<'main' | 'settings' | 'calendar'>(initialView)
  const [settingsTab, setSettingsTab] = useState<'opencode' | 'deepseek' | 'gemini' | 'codex'>('opencode')
  const [usageData, setUsageData] = useState<any>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(true)
  const [isClickThrough, setIsClickThrough] = useState(false)
  const [mainReady, setMainReady] = useState(true)

  const showOverlay = (mode: 'settings' | 'calendar', tab?: 'opencode' | 'deepseek' | 'gemini' | 'codex') => {
    if (mode === 'calendar') {
      window.electronAPI?.openCalendarWindow?.()
      return
    }
    if (tab) {
      setSettingsTab(tab)
    }
    setView(mode)
  }

  const closeOverlay = () => {
    setView('main')
    setMainReady(true)
  }

  useEffect(() => {
    if (!window.electronAPI) return

    window.electronAPI.getConfig().then((cfg) => {
      setIsAlwaysOnTop(cfg.alwaysOnTop ?? true)
      setIsClickThrough(!!cfg.clickThrough)
    })

    const unsubUsage = window.electronAPI.onUsageUpdate((data) => {
      setUsageData(data)
      setIsRefreshing(false)
    })

    const unsubClickThrough = window.electronAPI.onClickThroughChanged((nextVal) => {
      setIsClickThrough(nextVal)
    })

    const unsubOverlay = window.electronAPI.onOpenOverlay?.((mode) => {
      showOverlay(mode)
    })

    window.electronAPI.fetchUsageNow().then((data) => {
      setUsageData(data)
    })

    return () => {
      unsubUsage()
      unsubClickThrough()
      unsubOverlay?.()
    }
  }, [])

  if (view === 'settings') {
    return <SettingsWindow onClose={closeOverlay} initialTab={settingsTab} />
  }

  if (view === 'calendar') {
    return (
      <CalendarWindow
        onClose={() => {
          if (window.electronAPI?.closeCurrentWindow) {
            window.electronAPI.closeCurrentWindow()
          } else {
            window.close()
          }
        }}
      />
    )
  }

  const handleManualRefresh = async () => {
    if (!window.electronAPI || isRefreshing) return
    setIsRefreshing(true)
    await window.electronAPI.fetchUsageNow()
    setTimeout(() => setIsRefreshing(false), 500)
  }

  const toggleAlwaysOnTop = () => {
    const next = !isAlwaysOnTop
    setIsAlwaysOnTop(next)
    window.electronAPI?.setAlwaysOnTop(next)
  }

  const toggleClickThrough = () => {
    const next = !isClickThrough
    setIsClickThrough(next)
    window.electronAPI?.setIgnoreMouseEvents(next)
  }

  const formatTokens = (n: number = 0): string => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`
    return String(n)
  }

  const providerLabel = (id: string): string => {
    const map: Record<string, string> = {
      'antigravity-manager': 'AGY',
      'opencode-go': 'Go',
      'cursor-acp': 'Cursor',
      ahei: 'Ahei',
      claude: 'Claude',
      codex: 'Codex',
      pi: 'Pi',
      zcode: 'Zcode'
    }
    return map[id] || id
  }

  const byProvider = (usageData?.todayStats?.breakdown?.byProvider || {}) as Record<string, number>
  const providerSummary = Object.entries(byProvider)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id, n]) => `${providerLabel(id)} ${formatTokens(n)}`)
    .join(' · ')

  const getLatencyBadge = (latency?: number) => {
    if (!latency) return null
    let color = 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
    if (latency > 800) color = 'text-rose-400 bg-rose-500/10 border-rose-500/20'
    else if (latency > 300) color = 'text-amber-400 bg-amber-500/10 border-amber-500/20'

    return (
      <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${color} flex items-center gap-1`}>
        <Activity className="w-2.5 h-2.5" />
        {latency}ms
      </span>
    )
  }

  return (
    <div className="w-full h-screen p-2 flex flex-col box-border font-sans select-none overflow-hidden">
      {/* 纯净 Acrylic 磨砂主容器 */}
      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={mainReady ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.96 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        className="glass-panel-pure w-full h-full rounded-[22px] p-3 flex flex-col justify-between overflow-hidden shadow-2xl relative"
      >
        {/* 顶部标题栏（可拖拽） */}
        <div className="app-drag-region flex items-center justify-between pb-1.5 border-b border-white/10">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
            <span className="text-xs font-semibold tracking-wider text-white/90">
              TokenMonitor
            </span>
            <span className="text-[10px] text-white/40 tabular-nums whitespace-nowrap">
              v{packageJson.version}
            </span>
            {getLatencyBadge(usageData?.latency_ms)}
          </div>

          {/* 右侧操作按钮组 */}
          <div className="app-no-drag flex items-center gap-1">
            <button
              onClick={() => void showOverlay('settings')}
              title="设置"
              className="glass-button-pure p-1.5 rounded-lg text-white/60 hover:text-white"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => void showOverlay('calendar')}
              title="用量日历统计"
              className="glass-button-pure p-1.5 rounded-lg text-white/60 hover:text-blue-400"
            >
              <BarChart2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={toggleAlwaysOnTop}
              title={isAlwaysOnTop ? '取消置顶' : '窗口置顶'}
              className={`p-1.5 rounded-lg border transition-all ${
                isAlwaysOnTop
                  ? 'bg-blue-500/20 border-blue-500/40 text-blue-300'
                  : 'glass-button-pure text-white/50'
              }`}
            >
              <Pin className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={toggleClickThrough}
              title={isClickThrough ? '取消穿透 (快捷键 Ctrl+Shift+P)' : '鼠标穿透 (快捷键 Ctrl+Shift+P)'}
              className={`p-1.5 rounded-lg border transition-all ${
                isClickThrough
                  ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300 shadow-[0_0_8px_rgba(16,185,129,0.3)]'
                  : 'glass-button-pure text-white/50'
              }`}
            >
              <MousePointer className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => window.electronAPI?.minimizeWindow()}
              title="最小化"
              className="glass-button-pure p-1.5 rounded-lg text-white/60 hover:text-white ml-0.5"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => window.electronAPI?.closeCurrentWindow()}
              title="关闭到托盘"
              className="glass-button-pure p-1.5 rounded-lg text-white/60 hover:text-rose-400"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* 错误提示或未配置提示 */}
        {usageData?.error && (
          <div className="app-no-drag my-1 p-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-[11px] flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
              <span>
                {usageData.error === 'config_missing' ? '未配置 API Key，请点击右侧按钮进入设置' : usageData.error}
              </span>
            </div>
            {usageData.error === 'config_missing' && (
              <button
                onClick={() => void showOverlay('settings')}
                className="px-2 py-0.5 rounded-md bg-amber-500/20 hover:bg-amber-500/30 text-[10px] font-medium"
              >
                去配置
              </button>
            )}
          </div>
        )}

        {/* 核心监控主体：左侧 Coding Plan 轮播 + 右侧今日 Token 统计 */}
        <div className="app-no-drag flex items-center justify-between gap-3 my-auto px-1">
          {/* 左侧 Coding Plan 轮播 */}
          <PlanCarousel
            data={usageData}
            onOpenSettings={(tab) => void showOverlay('settings', tab)}
          />

          {/* 右侧今日 Token 统计 (原封不动) */}
          <TodayTokens stats={usageData?.todayStats} />
        </div>

        {/* 底部信息栏 */}
        <div className="pt-1.5 border-t border-white/10 flex items-center justify-between text-[10px] text-white/40">
          <span
            onClick={handleManualRefresh}
            className="cursor-pointer hover:text-white/70 transition-colors"
          >
            上次刷新: {usageData?.last_refresh || '尚未同步'}
          </span>
          <span className="text-white/30 truncate max-w-[220px] text-right" title={providerSummary}>
            {providerSummary || '用量监控'}
          </span>
        </div>
      </motion.div>
    </div>
  )
}
