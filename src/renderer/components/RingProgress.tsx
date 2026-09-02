import React from 'react'
import { motion } from 'framer-motion'

interface RingProgressProps {
  label: string
  percent: number
  resetsAt?: string | null
  subText?: string | null
  size?: number
}

export const RingProgress: React.FC<RingProgressProps> = ({
  label,
  percent = 0,
  resetsAt,
  subText,
  size = 62
}) => {
  const strokeWidth = 5.5
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const clampedPct = Math.min(100, Math.max(0, percent))
  const strokeDashoffset = circumference - (clampedPct / 100) * circumference

  // 剩余模式下的告警颜色（剩余越少越红，剩余充足越蓝绿）
  const getGradientColors = (pct: number) => {
    // 如果是 DeepSeek 消耗模式（label 包含“消耗”）：百分比越大越红
    if (label.includes('消耗')) {
      if (pct >= 90) return { start: '#ef4444', end: '#dc2626' }
      if (pct >= 70) return { start: '#f59e0b', end: '#ea580c' }
      return { start: '#38bdf8', end: '#0284c7' }
    }
    // 剩余模式：剩余低于 15% 红色告警，低于 35% 橙色预警，高于 35% 充足科技蓝/青
    if (pct <= 15) return { start: '#ef4444', end: '#dc2626' }
    if (pct <= 35) return { start: '#f59e0b', end: '#ea580c' }
    return { start: '#38bdf8', end: '#2563eb' }
  }

  const { start, end } = getGradientColors(clampedPct)

  // 格式化重置倒计时（支持 ISO 8601 与友好格式）
  const formatReset = (isoString?: string | null) => {
    if (!isoString) return subText || '–'
    try {
      const d = new Date(isoString)
      const now = new Date()
      const diffMs = d.getTime() - now.getTime()
      if (diffMs <= 0) return '即将重置'
      const diffMin = Math.max(1, Math.ceil(diffMs / 60000))
      if (diffMin >= 24 * 60) {
        const days = Math.floor(diffMin / (24 * 60))
        const hours = Math.floor((diffMin % (24 * 60)) / 60)
        return `${days}天${hours}时`
      }
      if (diffMin >= 60) {
        const hours = Math.floor(diffMin / 60)
        const mins = diffMin % 60
        return `${hours}时${mins}分`
      }
      return `${diffMin}分`
    } catch {
      return subText || '–'
    }
  }

  const gradientId = `ring-grad-${label.replace(/\s+/g, '-')}`

  return (
    <div className="flex flex-col items-center justify-center text-center select-none shrink-0 min-w-[70px]">
      {/* 圆环 SVG 容器 */}
      <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="transform -rotate-90">
          <defs>
            <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={start} />
              <stop offset="100%" stopColor={end} />
            </linearGradient>
          </defs>

          {/* 底层轨道 */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="rgba(255, 255, 255, 0.08)"
            strokeWidth={strokeWidth}
          />

          {/* 进度环 */}
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={`url(#${gradientId})`}
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            strokeLinecap="round"
          />
        </svg>

        {/* 中心大号百分比 */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none gap-0.5">
          <span className="text-[15px] font-bold tracking-tight text-white/95 tabular-nums">
            {percent}
          </span>
          <span className="text-[9px] font-medium text-white/50 mt-0.5">%</span>
        </div>
      </div>

      {/* 标签 */}
      <div className="text-[11px] font-medium text-white/85 mt-1 leading-tight">{label}</div>

      {/* 重置倒计时 / 次要信息（独立行高，绝不裁切） */}
      <div className="text-[10px] text-white/50 tracking-tight whitespace-nowrap mt-0.5 leading-[14px] tabular-nums">
        {formatReset(resetsAt)}
      </div>
    </div>
  )
}
