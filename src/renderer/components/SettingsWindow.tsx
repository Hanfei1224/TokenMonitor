import React, { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { X, Key, Check, Settings, ShieldCheck, LogOut, ExternalLink, Loader2 } from 'lucide-react'
import { popupAnimate, popupInitial, popupSpring, usePopupEnter } from '../popupMotion.js'

interface SettingsWindowProps {
  onClose: () => void
  initialTab?: 'opencode' | 'deepseek' | 'gemini'
}

export const SettingsWindow: React.FC<SettingsWindowProps> = ({ onClose, initialTab = 'opencode' }) => {
  const [activeTab, setActiveTab] = useState<'opencode' | 'deepseek' | 'gemini'>(initialTab)
  const [opencodeKey, setOpencodeKey] = useState('')
  const [deepseekKey, setDeepseekKey] = useState('')
  const [geminiEmail, setGeminiEmail] = useState<string | null>(null)
  const [isLoggingInGoogle, setIsLoggingInGoogle] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [savedSuccess, setSavedSuccess] = useState(false)
  const enter = usePopupEnter()

  const reloadData = () => {
    setSavedSuccess(false)
    setIsSaving(false)
    if (window.electronAPI) {
      window.electronAPI.getConfig().then((cfg) => {
        setOpencodeKey(cfg.opencodeApiKey || cfg.apiKey || '')
        setDeepseekKey(cfg.deepseekApiKey || '')
        setGeminiEmail(cfg.geminiAccountEmail || null)
      })
    }
  }

  useEffect(() => {
    reloadData()
  }, [])

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab)
    }
  }, [initialTab])

  const handleSave = async () => {
    if (!window.electronAPI) return
    setIsSaving(true)
    await window.electronAPI.saveConfig({
      opencodeApiKey: opencodeKey.trim(),
      apiKey: opencodeKey.trim(),
      deepseekApiKey: deepseekKey.trim()
    })
    setIsSaving(false)
    setSavedSuccess(true)
    setTimeout(() => {
      onClose()
    }, 300)
  }

  const handleGoogleLogin = async () => {
    if (!window.electronAPI || isLoggingInGoogle) return
    setIsLoggingInGoogle(true)
    try {
      const res = await window.electronAPI.startGoogleOAuth()
      if (res.success && res.email) {
        setGeminiEmail(res.email)
      }
    } finally {
      setIsLoggingInGoogle(false)
    }
  }

  const handleGoogleLogout = async () => {
    if (!window.electronAPI) return
    await window.electronAPI.logoutGoogleOAuth()
    setGeminiEmail(null)
  }

  return (
    <div className="w-full h-screen p-2 flex flex-col box-border font-sans select-none overflow-hidden">
      <motion.div
        initial={popupInitial}
        animate={enter ? popupAnimate : popupInitial}
        transition={enter ? popupSpring : { duration: 0 }}
        className="glass-panel-pure w-full h-full rounded-[22px] p-4 shadow-2xl flex flex-col justify-between text-white border border-white/20 relative"
        style={{ willChange: enter ? 'transform, opacity' : 'auto' }}
      >
        {/* 顶部标题栏 */}
        <div className="app-drag-region flex items-center justify-between pb-2 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2">
            <Settings className="w-4 h-4 text-blue-400" />
            <h3 className="text-sm font-semibold tracking-wide text-white/90">多通道设置</h3>
          </div>

          {/* 切换 Tab */}
          <div className="app-no-drag flex items-center gap-1 bg-white/10 p-0.5 rounded-xl border border-white/10">
            <button
              onClick={() => setActiveTab('opencode')}
              className={`px-2.5 py-0.5 rounded-lg text-[11px] font-medium transition-all ${
                activeTab === 'opencode'
                  ? 'bg-blue-500 text-white shadow-sm'
                  : 'text-white/60 hover:text-white'
              }`}
            >
              OpenCode
            </button>
            <button
              onClick={() => setActiveTab('deepseek')}
              className={`px-2.5 py-0.5 rounded-lg text-[11px] font-medium transition-all ${
                activeTab === 'deepseek'
                  ? 'bg-cyan-500 text-white shadow-sm'
                  : 'text-white/60 hover:text-white'
              }`}
            >
              DeepSeek
            </button>
            <button
              onClick={() => setActiveTab('gemini')}
              className={`px-2.5 py-0.5 rounded-lg text-[11px] font-medium transition-all ${
                activeTab === 'gemini'
                  ? 'bg-purple-500 text-white shadow-sm'
                  : 'text-white/60 hover:text-white'
              }`}
            >
              Gemini
            </button>
          </div>

          <button
            onClick={onClose}
            className="app-no-drag glass-button-pure p-1 rounded-full text-white/60 hover:text-rose-400"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 内容区域 */}
        <div className="app-no-drag flex flex-col gap-3 text-xs my-auto px-1 py-1">
          {activeTab === 'opencode' && (
            <div className="flex flex-col gap-1.5">
              <label className="text-white/80 font-medium flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Key className="w-3.5 h-3.5 text-blue-400" />
                  <span>OpenCode API Key</span>
                </span>
                <span className="text-[10px] text-white/40">用于获取 5H/周/月 额度</span>
              </label>
              <input
                type="password"
                value={opencodeKey}
                onChange={(e) => setOpencodeKey(e.target.value)}
                placeholder="sk-..."
                className="w-full rounded-xl bg-white/10 border border-white/15 px-3 py-2 text-white placeholder-white/30 focus:outline-none focus:border-blue-400 focus:bg-white/15 transition-all text-xs"
              />
            </div>
          )}

          {activeTab === 'deepseek' && (
            <div className="flex flex-col gap-1.5">
              <label className="text-white/80 font-medium flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Key className="w-3.5 h-3.5 text-cyan-400" />
                  <span>DeepSeek 官方 API Key</span>
                </span>
                <span className="text-[10px] text-white/40">用于查询当前账户可用余额</span>
              </label>
              <input
                type="password"
                value={deepseekKey}
                onChange={(e) => setDeepseekKey(e.target.value)}
                placeholder="sk-..."
                className="w-full rounded-xl bg-white/10 border border-white/15 px-3 py-2 text-white placeholder-white/30 focus:outline-none focus:border-cyan-400 focus:bg-white/15 transition-all text-xs"
              />
            </div>
          )}

          {activeTab === 'gemini' && (
            <div className="flex flex-col gap-2">
              <label className="text-white/80 font-medium flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-purple-400" />
                  <span>Google OAuth 网页一键授权</span>
                </span>
                <span className="text-[10px] text-white/40">用于 Gemini Pro 订阅</span>
              </label>

              {geminiEmail ? (
                <div className="flex items-center justify-between p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/20">
                  <div className="flex flex-col">
                    <span className="text-[10px] text-purple-300/70">当前授权账号</span>
                    <span className="text-xs font-semibold text-purple-200">{geminiEmail}</span>
                  </div>
                  <button
                    onClick={handleGoogleLogout}
                    className="px-2.5 py-1 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 text-[11px] flex items-center gap-1 border border-rose-500/30 transition-all"
                  >
                    <LogOut className="w-3 h-3" />
                    退出授权
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleGoogleLogin}
                  disabled={isLoggingInGoogle}
                  className="w-full py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 active:scale-98 text-white font-medium text-xs flex items-center justify-center gap-2 shadow-lg shadow-purple-600/30 transition-all"
                >
                  {isLoggingInGoogle ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>正在打开浏览器等待登录...</span>
                    </>
                  ) : (
                    <>
                      <ExternalLink className="w-4 h-4" />
                      <span>在浏览器中一键登录 Google 授权</span>
                    </>
                  )}
                </button>
              )}
            </div>
          )}
        </div>

        {/* 底部按钮栏 */}
        <div className="app-no-drag flex justify-end gap-2 pt-2 border-t border-white/10 shrink-0">
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
            <span>{savedSuccess ? '已保存' : '保存配置'}</span>
          </button>
        </div>
      </motion.div>
    </div>
  )
}
