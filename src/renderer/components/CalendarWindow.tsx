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
  byModel: Record<string, number>
  byModelCalls: Record<string, number>
}

export interface MonthStatsData {
  days: Record<string, DayStats>
  summary: {
    total: number
    input: number
    output: number
    cache: number
    hit_rate: number
    requests: number
    breakdown?: {
      bySource: Record<string, number>
      byProvider: Record<string, number>
      byAgent: Record<string, number>
      byModel: Record<string, number>
      byModelCalls: Record<string, number>
    }
  }
}

function fmtNum(n: number = 0): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`
  return String(n)
}

function fmtCalls(n: number = 0): string {
  if (n >= 10_000) return fmtNum(n)
  return n.toLocaleString('en-US')
}

function emptyDay(dateStr: string): DayStats {
  return {
    date: dateStr,
    total: 0,
    input: 0,
    output: 0,
    cache_read: 0,
    cache_write: 0,
    hit_rate: 0,
    requests: 0,
    byModel: {},
    byModelCalls: {}
  }
}

function topEntries(rec?: Record<string, number>, n = 5): Array<[string, number]> {
  if (!rec) return []
  return Object.entries(rec)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
}

function RankChart({
  title,
  rec,
  format,
  barClass
}: {
  title: string
  rec?: Record<string, number>
  format: (n: number) => string
  barClass: string
}) {
  const items = topEntries(rec, 5)
  const max = items[0]?.[1] || 1
  return (
    <div className="flex flex-col gap-2 min-w-0">
      <span className="text-xs text-white/45 font-medium">{title}</span>
      {items.length === 0 ? (
        <span className="text-xs text-white/25 py-2">暂无数据</span>
      ) : (
        items.map(([name, n]) => (
          <div key={name} className="flex items-center gap-2" title={`${name} ${format(n)}`}>
            <span className="w-[108px] shrink-0 truncate text-xs text-white/65">{name}</span>
            <div className="flex-1 h-2.5 rounded-full bg-white/10 overflow-hidden">
              <div
                className={`h-full rounded-full ${barClass}`}
                style={{ width: `${Math.max(8, (n / max) * 100)}%` }}
              />
            </div>
            <span className="w-[44px] shrink-0 text-right text-xs tabular-nums text-white/85">
              {format(n)}
            </span>
          </div>
        ))
      )}
    </div>
  )
}

function StatChip({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <span className="text-xs text-white/40">{label}</span>
      <span
        className={`text-base leading-none font-semibold tabular-nums truncate ${
          accent ? 'text-blue-300' : 'text-white'
        }`}
      >
        {value}
      </span>
    </div>
  )
}

export const CalendarWindow: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [currentDate, setCurrentDate] = useState(() => new Date())
  const [statsData, setStatsData] = useState<MonthStatsData | null>(null)
  const [hoveredDay, setHoveredDay] = useState<DayStats | null>(null)

  const year = currentDate.getFullYear()
  const month = currentDate.getMonth() + 1

  const loadData = () => {
    if (window.electronAPI) {
      window.electronAPI.getCalendarStats(year, month).then((res: MonthStatsData) => {
        setStatsData(res)
      })
    }
  }

  useEffect(() => {
    loadData()
    const timer = window.setInterval(loadData, 5000)
    return () => window.clearInterval(timer)
  }, [year, month])

  const handlePrevMonth = () => {
    setHoveredDay(null)
    setCurrentDate(new Date(year, month - 2, 1))
  }

  const handleNextMonth = () => {
    setHoveredDay(null)
    setCurrentDate(new Date(year, month, 1))
  }

  const daysInMonth = new Date(year, month, 0).getDate()
  const firstDayWeek = (new Date(year, month - 1, 1).getDay() + 6) % 7

  const cells: (DayStats | null)[] = []
  for (let i = 0; i < firstDayWeek; i++) {
    cells.push(null)
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    cells.push(statsData?.days[dateStr] || emptyDay(dateStr))
  }
  while (cells.length % 7 !== 0) {
    cells.push(null)
  }

  const getHeatmapColor = (total: number) => {
    if (!total || total === 0) return 'bg-white/5 text-white/40 border border-white/5'
    if (total > 5_000_000) return 'bg-blue-500 text-white font-bold shadow-[0_0_10px_rgba(59,130,246,0.6)] border border-blue-400'
    if (total > 1_000_000) return 'bg-blue-600/80 text-white font-semibold shadow-[0_0_8px_rgba(37,99,235,0.4)] border border-blue-500/50'
    if (total > 200_000) return 'bg-blue-700/60 text-blue-100 border border-blue-600/40'
    return 'bg-blue-900/40 text-blue-200 border border-blue-800/30'
  }

  const card = hoveredDay
    ? {
        key: hoveredDay.date,
        title: `${month}月${Number(hoveredDay.date.slice(8))}日`,
        hint: '当日',
        total: hoveredDay.total,
        input: hoveredDay.input,
        output: hoveredDay.output,
        cache: hoveredDay.cache_read + hoveredDay.cache_write,
        hit_rate: hoveredDay.hit_rate,
        requests: hoveredDay.requests,
        byModel: hoveredDay.byModel || {},
        byModelCalls: hoveredDay.byModelCalls || {}
      }
    : {
        key: 'month',
        title: `${year}年${month}月`,
        hint: '当月',
        total: statsData?.summary.total || 0,
        input: statsData?.summary.input || 0,
        output: statsData?.summary.output || 0,
        cache: statsData?.summary.cache || 0,
        hit_rate: statsData?.summary.hit_rate || 0,
        requests: statsData?.summary.requests || 0,
        byModel: statsData?.summary.breakdown?.byModel,
        byModelCalls: statsData?.summary.breakdown?.byModelCalls
      }

  const hasRanks =
    Object.keys(card.byModelCalls || {}).length > 0 ||
    Object.keys(card.byModel || {}).length > 0

  return (
    <div className="w-full h-screen p-2 flex flex-col box-border font-sans select-none overflow-hidden">
      <div className="glass-panel-pure relative w-full h-full rounded-[22px] px-6 pt-5 pb-5 shadow-2xl flex flex-col text-white border border-white/20 overflow-hidden">
        <div className="app-drag-region flex items-center justify-between pb-3 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2.5">
            <Calendar className="w-5 h-5 text-blue-400" />
            <span className="text-base font-semibold tracking-wide">用量日历统计</span>
          </div>

          <div className="app-no-drag flex items-center gap-2">
            <button
              onClick={handlePrevMonth}
              className="glass-button-pure p-2 rounded-xl text-white/70 hover:text-white"
            >
              <ChevronLeft className="w-[18px] h-[18px]" />
            </button>
            <span className="text-[15px] font-semibold px-3.5 py-1.5 rounded-xl bg-white/10 tabular-nums">
              {year}年{month}月
            </span>
            <button
              onClick={handleNextMonth}
              className="glass-button-pure p-2 rounded-xl text-white/70 hover:text-white"
            >
              <ChevronRight className="w-[18px] h-[18px]" />
            </button>
            <button
              onClick={onClose}
              className="glass-button-pure p-2 rounded-xl text-white/70 hover:text-rose-400 ml-1"
            >
              <X className="w-[18px] h-[18px]" />
            </button>
          </div>
        </div>

        <div className="flex flex-1 min-h-0 gap-6 pt-4">
          <div className="shrink-0 flex flex-col w-[520px]">
            <div className="grid grid-cols-7 gap-3 text-center text-[13px] font-medium tracking-wider text-white/45">
              <span>一</span>
              <span>二</span>
              <span>三</span>
              <span>四</span>
              <span>五</span>
              <span>六</span>
              <span>日</span>
            </div>

            <div
              className="app-no-drag grid grid-cols-7 gap-3 mt-2.5 content-start"
              onMouseLeave={() => setHoveredDay(null)}
            >
              {cells.map((day, idx) => {
                if (!day) {
                  return <div key={`empty-${idx}`} className="w-16 h-16" />
                }
                const dNum = new Date(day.date).getDate()
                const active = hoveredDay?.date === day.date
                return (
                  <div
                    key={day.date}
                    onMouseEnter={() => setHoveredDay(day)}
                    className={`cal-day w-16 h-16 rounded-2xl flex flex-col items-center justify-center cursor-pointer ${getHeatmapColor(
                      day.total
                    )} ${active ? 'ring-2 ring-white/70' : ''}`}
                  >
                    <span className="text-base leading-none font-medium">{dNum}</span>
                    {day.total > 0 && (
                      <span className="text-xs leading-none mt-1.5 opacity-85 tabular-nums">
                        {fmtNum(day.total)}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          <div className="app-no-drag flex-1 min-w-0 flex flex-col border-l border-white/10 pl-6">
            <AnimatePresence mode="wait">
              <motion.div
                key={card.key}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.16 }}
                className="flex flex-col gap-5 h-full"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[15px] font-semibold text-white/90">{card.title}</span>
                  <span className="text-xs px-2 py-1 rounded-lg bg-white/10 text-white/50">
                    {card.hint}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-x-4 gap-y-4 rounded-2xl bg-white/[0.04] border border-white/10 px-4 py-3.5">
                  <StatChip label="总 Token" value={fmtNum(card.total)} accent />
                  <StatChip label="输入" value={fmtNum(card.input)} />
                  <StatChip label="输出" value={fmtNum(card.output)} />
                  <StatChip label="缓存" value={fmtNum(card.cache)} />
                  <StatChip label="调用总数" value={fmtCalls(card.requests)} />
                  <StatChip label="缓存率" value={`${card.hit_rate || 0}%`} accent />
                </div>

                <div className={`flex flex-col gap-5 ${hasRanks ? 'flex-1 min-h-0 justify-evenly' : ''}`}>
                  <RankChart
                    title="模型调用排行"
                    rec={card.byModelCalls}
                    format={fmtCalls}
                    barClass="bg-sky-400/85"
                  />
                  <RankChart
                    title="Token 用量排行"
                    rec={card.byModel}
                    format={fmtNum}
                    barClass="bg-indigo-400/85"
                  />
                </div>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  )
}
