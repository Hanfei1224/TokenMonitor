import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Calendar, ChevronLeft, ChevronRight } from 'lucide-react'

export interface DayStats {
  date: string
  total: number
  input: number
  output: number
  cache_read: number
  cache_write: number
  hit_rate: number
  requests: number
}

export interface MonthStatsData {
  days: Record<string, DayStats>
  summary: {
    total: number
    input: number
    output: number
    cache: number
    hit_rate: number
  }
}

interface StatsCalendarModalProps {
  isOpen: boolean
  onClose: () => void
}

function fmt(n: number = 0): string {
  return n.toLocaleString('en-US')
}

function fmtNum(n: number = 0): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`
  return String(n)
}

export const StatsCalendarModal: React.FC<StatsCalendarModalProps> = ({ isOpen, onClose }) => {
  const [currentDate, setCurrentDate] = useState(() => new Date())
  const [statsData, setStatsData] = useState<MonthStatsData | null>(null)
  const [hoveredDay, setHoveredDay] = useState<{ day: DayStats; x: number; y: number } | null>(null)

  const year = currentDate.getFullYear()
  const month = currentDate.getMonth() + 1

  useEffect(() => {
    if (isOpen && window.electronAPI) {
      window.electronAPI.getCalendarStats(year, month).then((res: MonthStatsData) => {
        setStatsData(res)
      })
    }
  }, [isOpen, year, month])

  const handlePrevMonth = () => {
    setCurrentDate(new Date(year, month - 2, 1))
  }

  const handleNextMonth = () => {
    setCurrentDate(new Date(year, month, 1))
  }

  // 计算当月网格数据
  const daysInMonth = new Date(year, month, 0).getDate()
  // 1号是周几 (0是周日, 转换为 0=周一 ... 6=周日)
  const firstDayWeek = (new Date(year, month - 1, 1).getDay() + 6) % 7

  const cells: (DayStats | null)[] = []
  for (let i = 0; i < firstDayWeek; i++) {
    cells.push(null)
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const dayStat = statsData?.days[dateStr] || {
      date: dateStr,
      total: 0,
      input: 0,
      output: 0,
      cache_read: 0,
      cache_write: 0,
      hit_rate: 0,
      requests: 0
    }
    cells.push(dayStat)
  }

  const getHeatmapColor = (total: number) => {
    if (!total || total === 0) return 'bg-white/5 text-white/40 border border-white/5'
    if (total > 5_000_000) return 'bg-blue-500 text-white font-bold shadow-[0_0_10px_rgba(59,130,246,0.6)] border border-blue-400'
    if (total > 1_000_000) return 'bg-blue-600/80 text-white font-semibold shadow-[0_0_8px_rgba(37,99,235,0.4)] border border-blue-500/50'
    if (total > 200_000) return 'bg-blue-700/60 text-blue-100 border border-blue-600/40'
    return 'bg-blue-900/40 text-blue-200 border border-blue-800/30'
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3">
          {/* 背景遮罩 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/50 backdrop-blur-md"
          />

          {/* 模态卡片 */}
          <motion.div
            initial={{ scale: 0.92, opacity: 0, y: 12 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.92, opacity: 0, y: 12 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="glass-panel-pure relative w-full max-w-[390px] rounded-3xl p-4 shadow-2xl z-10 flex flex-col gap-3 text-white border border-white/20 select-none"
          >
            {/* 顶部标题与月份切换 */}
            <div className="flex items-center justify-between pb-2 border-b border-white/10">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-blue-400" />
                <span className="text-sm font-semibold tracking-wide">用量日历统计</span>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={handlePrevMonth}
                  className="glass-button-pure p-1 rounded-lg text-white/70 hover:text-white"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-lg bg-white/10 tabular-nums">
                  {year}年{month}月
                </span>
                <button
                  onClick={handleNextMonth}
                  className="glass-button-pure p-1 rounded-lg text-white/70 hover:text-white"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={onClose}
                  className="glass-button-pure p-1 rounded-lg text-white/70 hover:text-rose-400 ml-1"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* 周一至周日标题 */}
            <div className="grid grid-cols-7 gap-1.5 text-center text-[10px] font-medium text-white/40">
              <span>一</span>
              <span>二</span>
              <span>三</span>
              <span>四</span>
              <span>五</span>
              <span>六</span>
              <span>日</span>
            </div>

            {/* 日历网格 */}
            <div className="grid grid-cols-7 gap-1.5 min-h-[220px]">
              {cells.map((day, idx) => {
                if (!day) {
                  return <div key={`empty-${idx}`} className="w-[44px] h-[40px]" />
                }
                const dNum = new Date(day.date).getDate()
                return (
                  <motion.div
                    key={day.date}
                    whileHover={{ scale: 1.08 }}
                    onMouseEnter={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect()
                      setHoveredDay({ day, x: rect.left, y: rect.top })
                    }}
                    onMouseLeave={() => setHoveredDay(null)}
                    className={`w-[44px] h-[40px] rounded-xl flex flex-col items-center justify-center cursor-pointer transition-all ${getHeatmapColor(
                      day.total
                    )}`}
                  >
                    <span className="text-[11px] leading-none font-medium">{dNum}</span>
                    {day.total > 0 && (
                      <span className="text-[9px] leading-none mt-1 opacity-85 tabular-nums">
                        {fmtNum(day.total)}
                      </span>
                    )}
                  </motion.div>
                )
              })}
            </div>

            {/* 当月汇总栏 */}
            <div className="pt-2 border-t border-white/10 flex items-center justify-between text-[11px] text-white/70">
              <span>
                当月总: <b className="text-white font-semibold">{fmtNum(statsData?.summary.total || 0)}</b>
              </span>
              <span>
                输入: <b className="text-white font-semibold">{fmtNum(statsData?.summary.input || 0)}</b>
              </span>
              <span>
                输出: <b className="text-white font-semibold">{fmtNum(statsData?.summary.output || 0)}</b>
              </span>
              <span>
                缓存率: <b className="text-blue-300 font-semibold">{statsData?.summary.hit_rate || 0}%</b>
              </span>
            </div>

            {/* 悬停详情 Tooltip */}
            {hoveredDay && (
              <div
                className="fixed z-50 pointer-events-none p-2.5 rounded-2xl glass-panel-pure bg-neutral-900/95 border border-white/20 text-white text-[11px] shadow-2xl flex flex-col gap-1 w-44"
                style={{
                  left: Math.min(window.innerWidth - 190, hoveredDay.x - 60),
                  top: Math.max(10, hoveredDay.y - 120)
                }}
              >
                <div className="font-semibold text-blue-300 pb-1 border-b border-white/10 flex items-center justify-between">
                  <span>{hoveredDay.day.date}</span>
                  <span className="text-[10px] text-white/50">{hoveredDay.day.requests} 次请求</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/50">总 Token</span>
                  <b className="tabular-nums font-semibold">{fmt(hoveredDay.day.total)}</b>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/50">输入</span>
                  <b className="tabular-nums">{fmt(hoveredDay.day.input)}</b>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/50">输出</span>
                  <b className="tabular-nums">{fmt(hoveredDay.day.output)}</b>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/50">缓存</span>
                  <b className="tabular-nums">{fmt(hoveredDay.day.cache_read + hoveredDay.day.cache_write)}</b>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/50">缓存命中率</span>
                  <b className="tabular-nums text-emerald-400">{hoveredDay.day.hit_rate}%</b>
                </div>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
