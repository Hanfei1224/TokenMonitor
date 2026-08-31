import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Key, Eye, Pin, Check } from 'lucide-react'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
  onSaved: () => void
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, onSaved }) => {
  const [apiKey, setApiKey] = useState('')
  const [alwaysOnTop, setAlwaysOnTop] = useState(true)
  const [opacity, setOpacity] = useState(1.0)
  const [planName, setPlanName] = useState('OpenCode Go')
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (isOpen && window.electronAPI) {
      window.electronAPI.getConfig().then((cfg) => {
        setApiKey(cfg.apiKey || '')
        setAlwaysOnTop(cfg.alwaysOnTop ?? true)
        setOpacity(cfg.opacity ?? 1.0)
        setPlanName(cfg.planName || 'OpenCode Go')
      })
    }
  }, [isOpen])

  const handleSave = async () => {
    if (!window.electronAPI) return
    setIsSaving(true)
    await window.electronAPI.saveConfig({
      apiKey: apiKey.trim(),
      alwaysOnTop,
      opacity: Number(opacity) || 1.0,
      planName: planName.trim()
    })
    setIsSaving(false)
    onSaved()
    onClose()
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* 背景遮罩 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
          />

          {/* 模态框卡片 */}
          <motion.div
            initial={{ scale: 0.92, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.92, opacity: 0, y: 10 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="glass-panel-pure relative w-full max-w-sm rounded-3xl p-5 shadow-2xl z-10 flex flex-col gap-4 text-white border border-white/20"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold tracking-wide text-white/90">偏好与监控设置</h3>
              <button
                onClick={onClose}
                className="glass-button-pure p-1 rounded-full text-white/60 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex flex-col gap-3 text-xs">
              {/* API Key */}
              <div className="flex flex-col gap-1">
                <label className="text-white/70 flex items-center gap-1">
                  <Key className="w-3.5 h-3.5 text-blue-400" />
                  <span>OpenCode API Key</span>
                </label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-..."
                  className="w-full rounded-xl bg-white/10 border border-white/15 px-3 py-2 text-white placeholder-white/30 focus:outline-none focus:border-blue-400 focus:bg-white/15 transition-all text-xs"
                />
              </div>

              {/* 透明度 & 置顶 */}
              <div className="grid grid-cols-2 gap-2 pt-1">
                <div className="flex flex-col gap-1">
                  <label className="text-white/70 flex items-center gap-1">
                    <Eye className="w-3.5 h-3.5 text-purple-400" />
                    <span>窗口不透明度</span>
                  </label>
                  <select
                    value={opacity}
                    onChange={(e) => setOpacity(Number(e.target.value))}
                    className="w-full rounded-xl bg-white/10 border border-white/15 px-2 py-1.5 text-white focus:outline-none focus:border-blue-400 text-xs"
                  >
                    <option value={1.0} className="bg-neutral-800 text-white">100%</option>
                    <option value={0.8} className="bg-neutral-800 text-white">80%</option>
                    <option value={0.6} className="bg-neutral-800 text-white">60%</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1 justify-end">
                  <button
                    type="button"
                    onClick={() => setAlwaysOnTop(!alwaysOnTop)}
                    className={`w-full py-2 px-3 rounded-xl border flex items-center justify-center gap-1.5 transition-all ${
                      alwaysOnTop
                        ? 'bg-blue-500/20 border-blue-500/40 text-blue-300'
                        : 'bg-white/10 border-white/15 text-white/50'
                    }`}
                  >
                    <Pin className="w-3.5 h-3.5" />
                    <span>{alwaysOnTop ? '窗口置顶' : '普通窗口'}</span>
                  </button>
                </div>
              </div>
            </div>

            {/* 保存按钮 */}
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={onClose}
                className="px-3.5 py-1.5 rounded-xl text-white/60 hover:text-white text-xs hover:bg-white/10 transition-all"
              >
                取消
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="px-4 py-1.5 rounded-xl bg-blue-500 hover:bg-blue-600 active:scale-95 text-white font-medium text-xs flex items-center gap-1.5 shadow-lg shadow-blue-500/30 transition-all"
              >
                <Check className="w-3.5 h-3.5" />
                <span>保存配置</span>
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
