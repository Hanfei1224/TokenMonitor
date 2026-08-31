import { motion } from 'framer-motion'
import { Clock, Calendar, Zap, AlertCircle } from 'lucide-react'

interface UsageWindow {
  percent: number
  resetsAt: string | null
  current?: number
  total?: number
}

interface UsageCardProps {
  title: string
  windowType: 'rolling' | 'weekly' | 'monthly'
  data?: UsageWindow
}

export const UsageCard: React.FC<UsageCardProps> = ({ title, windowType, data }) => {
  const percent = data?.percent ?? 0

  // 状态颜色
  const getProgressColor = (pct: number) => {
    if (pct >= 90) return 'from-rose-500 to-red-600 shadow-rose-500/30'
    if (pct >= 70) return 'from-amber-500 to-orange-500 shadow-orange-500/30'
    return 'from-blue-500 to-indigo-600 shadow-blue-500/30'
  }

  const getBadgeColor = (pct: number) => {
    if (pct >= 90) return 'text-rose-400 bg-rose-500/10 border-rose-500/20'
    if (pct >= 70) return 'text-amber-400 bg-amber-500/10 border-amber-500/20'
    return 'text-blue-400 bg-blue-500/10 border-blue-500/20'
  }

  // 格式化重置时间
  const formatResetTime = (isoString?: string | null) => {
    if (!isoString) return null
    try {
      const d = new Date(isoString)
      const now = new Date()
      const diffMinutes = Math.max(1, Math.ceil((d.getTime() - now.getTime()) / 60000))
      if (windowType === 'rolling') {
        const hours = Math.floor(diffMinutes / 60)
        const mins = diffMinutes % 60
        return `${hours}时${mins}分`
      }
      const days = Math.floor(diffMinutes / (24 * 60))
      const hours = Math.floor((diffMinutes % (24 * 60)) / 60)
      return `${days}天${hours}时`
    } catch {
      return null
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="glass-card-pure rounded-2xl p-3.5 flex flex-col gap-2.5 relative overflow-hidden backdrop-blur-md"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-medium text-white/70">
          {windowType === 'rolling' && <Clock className="w-3.5 h-3.5 text-blue-400" />}
          {windowType === 'weekly' && <Calendar className="w-3.5 h-3.5 text-indigo-400" />}
          {windowType === 'monthly' && <Zap className="w-3.5 h-3.5 text-purple-400" />}
          <span>{title}</span>
        </div>

        <div className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${getBadgeColor(percent)} flex items-center gap-1`}>
          <span>{percent}%</span>
        </div>
      </div>

      {/* 进度条轨道 */}
      <div className="h-2 w-full bg-white/10 rounded-full overflow-hidden p-0.5 relative">
        <motion.div
          className={`h-full rounded-full bg-gradient-to-r ${getProgressColor(percent)} shadow-md`}
          initial={{ width: 0 }}
          animate={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
          transition={{ type: 'spring', damping: 20, stiffness: 120 }}
        />
      </div>

      {/* 重置倒计时 / 补充信息 */}
      <div className="flex items-center justify-between text-[11px] text-white/40">
        {data?.resetsAt ? (
          <span>{formatResetTime(data.resetsAt)}</span>
        ) : (
          <span>实时监控中</span>
        )}
        {percent >= 90 && (
          <span className="flex items-center gap-1 text-rose-400">
            <AlertCircle className="w-3 h-3" />
            额度即将耗尽
          </span>
        )}
      </div>
    </motion.div>
  )
}
