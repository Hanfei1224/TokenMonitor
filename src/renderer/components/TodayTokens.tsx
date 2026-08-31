import React from 'react'

export interface TodayStats {
  total: number
  input: number
  output: number
  cache: number
  hit_rate: number
  estimated?: number
  breakdown?: {
    bySource: Record<string, number>
    byProvider: Record<string, number>
    byAgent: Record<string, number>
  }
}

interface TodayTokensProps {
  stats?: TodayStats | null
}

function formatTokens(n: number = 0): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`
  return String(n)
}

export const TodayTokens: React.FC<TodayTokensProps> = ({ stats }) => {
  const rows = [
    { label: '今日总', val: formatTokens(stats?.total || 0), highlight: true },
    { label: '输入', val: formatTokens(stats?.input || 0) },
    { label: '输出', val: formatTokens(stats?.output || 0) },
    { label: '缓存', val: formatTokens(stats?.cache || 0) },
    { label: '缓存率', val: `${(stats?.hit_rate || 0).toFixed(1)}%` },
  ]

  return (
    <div className="flex flex-col justify-between w-[124px] h-[142px] border-l border-white/10 pl-3.5 select-none py-1">
      {rows.map((row) => (
        <div key={row.label} className="flex items-center justify-between gap-1.5">
          <span className="text-[12px] text-white/70 font-medium whitespace-nowrap">
            {row.label}
          </span>
          <span
            className={`inline-flex items-center justify-center w-[60px] h-[22px] rounded-lg text-[13px] font-semibold tabular-nums whitespace-nowrap ${
              row.highlight
                ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30 shadow-[0_0_8px_rgba(59,130,246,0.2)]'
                : 'bg-white/10 text-white/90 border border-white/10'
            }`}
          >
            {row.val}
          </span>
        </div>
      ))}
    </div>
  )
}
