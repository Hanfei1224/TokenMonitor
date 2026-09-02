import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, ipcMain, screen, nativeImage, globalShortcut } from 'electron'
import {
  addCodexAccount,
  addGeminiAccount,
  deleteAccount,
  getAccountState,
  loadConfig,
  renameAccount,
  saveApiAccount,
  saveConfig,
  setActiveAccount,
  ProviderId
} from './store.js'
import { getStorageDir } from './paths.js'
import { AccountUsageProgress, AccountUsageValue, fetchMultiPlanUsage, MultiPlanUsageData } from './usage.js'
import { startGoogleOAuth } from './geminiAuth.js'
import { getCodexAuthStatus, invalidateCodexSession, startCodexOAuth } from './codexAuth.js'
import { createTray } from './tray.js'
import { startStatsBackgroundScanner, stopStatsBackgroundScanner, getCachedTodayStats, getCachedMonthStats } from './stats.js'

process.on('uncaughtException', (err) => {
  console.error('uncaughtException', err)
})
process.on('unhandledRejection', (err) => {
  console.error('unhandledRejection', err)
})

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const APP_DISPLAY_NAME = 'TokenMonitor'
const MAIN_W = 470
const MAIN_H = 250
const CAL_W = 960
const CAL_H = 620

app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion,TranslateUI,MediaRouter')
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=128')
app.setName(APP_DISPLAY_NAME)
const storageDir = getStorageDir()
const sessionDir = path.join(storageDir, 'session')
fs.mkdirSync(storageDir, { recursive: true })
fs.mkdirSync(sessionDir, { recursive: true })
app.setPath('userData', storageDir)
app.setPath('sessionData', sessionDir)
if (process.platform === 'win32') {
  app.setAppUserModelId('com.token.monitor')
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
}

let mainWindow: BrowserWindow | null = null
let calendarWindow: BrowserWindow | null = null
let pollTimer: ReturnType<typeof setTimeout> | null = null
let pollInFlight: Promise<void> | null = null
let pollController: AbortController | null = null
let statsScannerStarted = false
let keepHidden = false
let isQuitting = false

let currentUsageData: MultiPlanUsageData = {
  plan_name: APP_DISPLAY_NAME,
  opencode: { configured: false },
  deepseek: { configured: false },
  gemini: { configured: false },
  codex: { configured: false },
  accountUsage: {
    opencode: {},
    deepseek: {},
    gemini: {},
    codex: {}
  },
  error: 'initializing'
}

function mergeAccountUsage(
  base: MultiPlanUsageData,
  provider: ProviderId,
  accountId: string,
  usage: AccountUsageValue,
  isActive: boolean
): MultiPlanUsageData {
  const next: MultiPlanUsageData = {
    ...base,
    accountUsage: {
      ...base.accountUsage,
      [provider]: {
        ...base.accountUsage[provider],
        [accountId]: usage
      }
    } as MultiPlanUsageData['accountUsage']
  }

  if (isActive && provider === 'opencode') next.opencode = usage as MultiPlanUsageData['opencode']
  if (isActive && provider === 'deepseek') next.deepseek = usage as MultiPlanUsageData['deepseek']
  if (isActive && provider === 'gemini') next.gemini = usage as MultiPlanUsageData['gemini']
  if (isActive && provider === 'codex') next.codex = usage as MultiPlanUsageData['codex']
  return next
}

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

const preloadPath = fs.existsSync(path.join(__dirname, '../preload/index.cjs'))
  ? path.join(__dirname, '../preload/index.cjs')
  : path.join(__dirname, '../preload/index.js')

function appTitle(): string {
  return `${APP_DISPLAY_NAME} ${app.getVersion()}`
}

function getAppIconPath(): string {
  const possiblePaths = [
    path.join(app.getAppPath(), 'build/icon.ico'),
    path.join(app.getAppPath(), 'build/icon.png'),
    path.join(__dirname, '../build/icon.ico'),
    path.join(__dirname, '../build/icon.png'),
    path.join(__dirname, '../../build/icon.ico'),
    path.join(__dirname, '../../build/icon.png'),
    path.resolve(process.cwd(), 'icon.ico'),
    path.resolve(process.cwd(), 'icon.png'),
    path.resolve(process.cwd(), 'src/icon.ico'),
    path.resolve(process.cwd(), 'src/icon.png')
  ]
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p
  }
  return ''
}

function stayHidden() {
  if (!keepHidden || !mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isVisible()) mainWindow.hide()
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  keepHidden = false
  mainWindow.setSkipTaskbar(true)
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function openCalendarWindow() {
  if (calendarWindow && !calendarWindow.isDestroyed()) {
    if (calendarWindow.isMinimized()) calendarWindow.restore()
    calendarWindow.show()
    calendarWindow.focus()
    return
  }

  const iconPath = getAppIconPath()
  const icon = iconPath ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty()
  const cfg = loadConfig()

  calendarWindow = new BrowserWindow({
    title: `用量日历 - ${appTitle()}`,
    width: CAL_W,
    height: CAL_H,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    center: true,
    alwaysOnTop: cfg.alwaysOnTop ?? true,
    skipTaskbar: true,
    show: false,
    backgroundColor: '#00000000',
    icon: iconPath || icon,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      spellcheck: false,
      backgroundThrottling: true
    }
  })

  if (iconPath) {
    calendarWindow.setIcon(iconPath)
  }

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    calendarWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?view=calendar`)
  } else if (isDev) {
    calendarWindow.loadURL('http://localhost:5173?view=calendar')
  } else {
    calendarWindow.loadFile(path.join(app.getAppPath(), 'dist/index.html'), {
      query: { view: 'calendar' }
    })
  }

  calendarWindow.once('ready-to-show', () => {
    if (!calendarWindow || calendarWindow.isDestroyed()) return
    calendarWindow.show()
    calendarWindow.focus()
  })

  calendarWindow.on('closed', () => {
    calendarWindow = null
  })
}

function requestOverlay(mode: 'settings' | 'calendar') {
  if (mode === 'calendar') {
    openCalendarWindow()
    return
  }
  showMainWindow()
  mainWindow?.webContents.send('open-overlay', mode)
}

function createMainWindow() {
  const cfg = loadConfig()
  const primaryDisplay = screen.getPrimaryDisplay()
  const { width: screenWidth } = primaryDisplay.workAreaSize

  const defaultX = screenWidth - MAIN_W - 32
  const defaultY = 48
  const iconPath = getAppIconPath()
  const icon = iconPath ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty()

  mainWindow = new BrowserWindow({
    title: appTitle(),
    width: MAIN_W,
    height: MAIN_H,
    x: cfg.windowPosition?.x ?? defaultX,
    y: cfg.windowPosition?.y ?? defaultY,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    alwaysOnTop: cfg.alwaysOnTop ?? true,
    skipTaskbar: true,
    show: false,
    backgroundColor: '#00000000',
    icon: iconPath || icon,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      spellcheck: false,
      backgroundThrottling: true
    }
  })

  if (iconPath) {
    mainWindow.setIcon(iconPath)
  }

  if (cfg.clickThrough) {
    mainWindow.setIgnoreMouseEvents(true, { forward: true })
  }

  let moveTimer: ReturnType<typeof setTimeout> | null = null
  mainWindow.on('moved', () => {
    if (keepHidden) return
    if (moveTimer) clearTimeout(moveTimer)
    moveTimer = setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      const [x, y] = mainWindow.getPosition()
      saveConfig({ windowPosition: { x, y } })
    }, 400)
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?view=main`)
  } else if (isDev) {
    mainWindow.loadURL('http://localhost:5173?view=main')
  } else {
    mainWindow.loadFile(path.join(app.getAppPath(), 'dist/index.html'), {
      query: { view: 'main' }
    })
  }

  mainWindow.on('show', () => {
    stayHidden()
  })
  mainWindow.on('restore', () => {
    stayHidden()
  })

  mainWindow.once('ready-to-show', () => {
    if (keepHidden) {
      mainWindow?.hide()
      return
    }
    mainWindow?.show()
    mainWindow?.focus()
    if (!statsScannerStarted) {
      statsScannerStarted = true
      startStatsBackgroundScanner()
    }
  })

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      mainWindow?.hide()
      mainWindow?.setSkipTaskbar(true)
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  try {
    createTray(mainWindow, {
      refresh: () => {
        void scheduleNextPoll()
      },
      openSettings: () => requestOverlay('settings')
    })
  } catch (err) {
    console.error('Create tray failed:', err)
  }

  startPolling()
}

const POLL_INTERVAL_MS = 60 * 1000
const POLL_TIMEOUT_MS = 30 * 1000

function clearPollTimer(): void {
  if (!pollTimer) return
  clearTimeout(pollTimer)
  pollTimer = null
}

function scheduleNextPoll(force = false): Promise<void> {
  if (pollInFlight) {
    if (!force) return pollInFlight
    const previous = pollInFlight
    pollController?.abort(new Error('配置已变更'))
    return previous.then(() => scheduleNextPoll())
  }
  clearPollTimer()

  const controller = new AbortController()
  pollController = controller
  const startTime = Date.now()
  const timeoutTimer = setTimeout(() => {
    controller.abort(new Error('用量请求超时'))
  }, POLL_TIMEOUT_MS)

  const promise = Promise.resolve().then(async () => {
    try {
      const cfg = loadConfig()
      const todayStats = getCachedTodayStats()
      let progressUsage = currentUsageData
      const onAccountUsage: AccountUsageProgress = (provider, accountId, usage) => {
        if (controller.signal.aborted) return
        progressUsage = mergeAccountUsage(
          progressUsage,
          provider,
          accountId,
          usage,
          cfg.activeAccountIds?.[provider] === accountId
        )
        currentUsageData = progressUsage
        mainWindow?.webContents.send('usage-update', currentUsageData, false)
      }
      const nextUsageData = await fetchMultiPlanUsage(cfg, todayStats, controller.signal, onAccountUsage)
      if (!controller.signal.aborted) {
        currentUsageData = nextUsageData
        mainWindow?.webContents.send('usage-update', currentUsageData, true)
      }
    } catch (err) {
      if (!controller.signal.aborted && !isQuitting) console.error('Fetch multi plan usage error:', err)
    } finally {
      clearTimeout(timeoutTimer)
      if (pollController === controller) pollController = null
      pollInFlight = null

      if (!isQuitting) {
        // 以发出请求的时间为起点，计算等待 60 秒后的下一次时间点
        const elapsed = Date.now() - startTime
        const delay = Math.max(0, POLL_INTERVAL_MS - elapsed)
        pollTimer = setTimeout(() => {
          pollTimer = null
          void scheduleNextPoll()
        }, delay)
      }
    }
  })
  pollInFlight = promise
  return promise
}

function startPolling() {
  void scheduleNextPoll()
}

function stopPolling(): void {
  clearPollTimer()
  const controller = pollController
  pollController = null
  controller?.abort(new Error('应用退出'))
}

function getSafeConfig(cfg: ReturnType<typeof loadConfig>) {
  return {
    alwaysOnTop: cfg.alwaysOnTop,
    clickThrough: cfg.clickThrough,
    windowPosition: cfg.windowPosition,
    activePlanIndex: cfg.activePlanIndex,
    activeAccountIds: cfg.activeAccountIds
  }
}

ipcMain.handle('get-config', () => {
  return getSafeConfig(loadConfig())
})
ipcMain.handle('save-config', (_event, newCfg) => {
  const updated = saveConfig(newCfg)
  if (mainWindow) {
    if (newCfg.alwaysOnTop !== undefined) mainWindow.setAlwaysOnTop(newCfg.alwaysOnTop)
    if (newCfg.clickThrough !== undefined) {
      mainWindow.setIgnoreMouseEvents(newCfg.clickThrough, { forward: true })
    }
  }
  startPolling()
  return getSafeConfig(updated)
})

ipcMain.handle('fetch-usage-now', async () => {
  await scheduleNextPoll()
  return currentUsageData
})

ipcMain.handle('get-today-stats', () => {
  return getCachedTodayStats()
})

ipcMain.handle('get-calendar-stats', (_event, year: number, month: number) => {
  return getCachedMonthStats(year, month)
})

ipcMain.handle('get-account-state', () => getAccountState())

ipcMain.handle('save-api-account', (_event, provider, name, apiKey, accountId) => {
  if (provider !== 'opencode' && provider !== 'deepseek') throw new Error('不支持的 API 通道')
  const state = saveApiAccount(provider, name, apiKey, accountId || undefined)
  void scheduleNextPoll(true)
  return state
})

ipcMain.handle('rename-account', (_event, provider, accountId, name) => {
  const state = renameAccount(provider, accountId, name)
  return state
})

ipcMain.handle('delete-account', (_event, provider, accountId) => {
  if (provider === 'codex') invalidateCodexSession()
  const state = deleteAccount(provider, accountId)
  void scheduleNextPoll(true)
  return state
})

ipcMain.handle('set-active-account', async (_event, provider, accountId) => {
  return setActiveAccount(provider, accountId)
})

ipcMain.handle('prepare-overlay', () => {})
ipcMain.handle('reveal-overlay', () => {})

ipcMain.handle('start-google-oauth', async () => {
  const res = await startGoogleOAuth()
  if (!res.success) return res
  if (!res.refreshToken) return { success: false, error: 'Google 登录未返回授权凭证' }
  const account = addGeminiAccount(res.refreshToken, res.email)
  await scheduleNextPoll(true)
  return {
    success: true,
    email: account.email,
    accountId: account.id
  }
})

ipcMain.handle('logout-google-oauth', async (_event, accountId) => {
  const state = deleteAccount('gemini', accountId)
  await scheduleNextPoll(true)
  return { success: true, state }
})

ipcMain.handle('get-codex-auth-status', () => getCodexAuthStatus())

ipcMain.handle('start-codex-oauth', async () => {
  const res = await startCodexOAuth({ persist: false })
  if (!res.success) return res
  if (!res.encrypted) return { success: false, error: 'ChatGPT 登录未返回授权凭证' }
  const account = addCodexAccount(res.encrypted, res.email)
  void scheduleNextPoll(true)
  return {
    success: true,
    email: account.email,
    accountId: account.id
  }
})

ipcMain.handle('logout-codex-oauth', async (_event, accountId) => {
  invalidateCodexSession()
  const state = deleteAccount('codex', accountId)
  void scheduleNextPoll(true)
  return { success: true, state }
})

ipcMain.on('open-settings-window', () => {
  requestOverlay('settings')
})

ipcMain.on('open-calendar-window', () => {
  openCalendarWindow()
})

ipcMain.on('close-current-window', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win && win !== mainWindow) {
    win.close()
  } else {
    mainWindow?.close()
  }
})

ipcMain.handle('set-always-on-top', (_event, flag: boolean) => {
  mainWindow?.setAlwaysOnTop(flag)
  saveConfig({ alwaysOnTop: flag })
})

ipcMain.handle('set-ignore-mouse-events', (_event, ignore: boolean) => {
  mainWindow?.setIgnoreMouseEvents(ignore, { forward: true })
  saveConfig({ clickThrough: ignore })
  if (mainWindow) {
    mainWindow.webContents.send('click-through-changed', ignore)
  }
})

ipcMain.on('window-minimize', () => mainWindow?.minimize())
ipcMain.on('window-close', () => {
  app.quit()
})

app.whenReady().then(() => {
  if (!hasSingleInstanceLock) return
  process.title = appTitle()
  createMainWindow()

  globalShortcut.register('CommandOrControl+Shift+P', () => {
    if (!mainWindow) return
    const cfg = loadConfig()
    const nextVal = !cfg.clickThrough
    mainWindow.setIgnoreMouseEvents(nextVal, { forward: true })
    saveConfig({ clickThrough: nextVal })
    mainWindow.webContents.send('click-through-changed', nextVal)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('before-quit', () => {
  isQuitting = true
  stopPolling()
  stopStatsBackgroundScanner()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})
