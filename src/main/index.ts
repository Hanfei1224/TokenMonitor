import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, ipcMain, screen, nativeImage, globalShortcut } from 'electron'
import { loadConfig, saveConfig } from './store.js'
import { getStorageDir } from './paths.js'
import { fetchMultiPlanUsage, MultiPlanUsageData } from './usage.js'
import { startGoogleOAuth } from './geminiAuth.js'
import { getCodexAuthStatus, logoutCodexOAuth, startCodexOAuth } from './codexAuth.js'
import { createTray } from './tray.js'
import { startStatsBackgroundScanner, getCachedTodayStats, getCachedMonthStats } from './stats.js'

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
let pollTimer: NodeJS.Timeout | null = null
let pollGeneration = 0
let statsScannerStarted = false
let keepHidden = false
let isQuitting = false

let currentUsageData: MultiPlanUsageData = {
  plan_name: APP_DISPLAY_NAME,
  opencode: { configured: false },
  deepseek: { configured: false },
  gemini: { configured: false },
  codex: { configured: false },
  error: 'initializing'
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
        scheduleNextPoll()
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

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('用量请求超时')), timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}

async function scheduleNextPoll() {
  if (pollTimer) {
    clearTimeout(pollTimer)
    pollTimer = null
  }

  const generation = ++pollGeneration
  const startTime = Date.now()
  try {
    const cfg = loadConfig()
    const todayStats = getCachedTodayStats()
    const nextUsageData = await withTimeout(fetchMultiPlanUsage(cfg, todayStats), POLL_TIMEOUT_MS)
    if (generation === pollGeneration) {
      currentUsageData = nextUsageData
      mainWindow?.webContents.send('usage-update', currentUsageData)
    }
  } catch (err) {
    console.error('Fetch multi plan usage error:', err)
  } finally {
    if (generation !== pollGeneration) return
    // 以发出请求的时间为起点，计算等待 60 秒后的下一次时间点
    const elapsed = Date.now() - startTime
    const delay = Math.max(0, POLL_INTERVAL_MS - elapsed)
    pollTimer = setTimeout(scheduleNextPoll, delay)
  }
}

function startPolling() {
  scheduleNextPoll()
}

ipcMain.handle('get-config', () => loadConfig())
ipcMain.handle('save-config', (_event, newCfg) => {
  const updated = saveConfig(newCfg)
  if (mainWindow) {
    if (newCfg.alwaysOnTop !== undefined) mainWindow.setAlwaysOnTop(newCfg.alwaysOnTop)
    if (newCfg.clickThrough !== undefined) {
      mainWindow.setIgnoreMouseEvents(newCfg.clickThrough, { forward: true })
    }
  }
  startPolling()
  return updated
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

ipcMain.handle('prepare-overlay', () => {})
ipcMain.handle('reveal-overlay', () => {})

ipcMain.handle('start-google-oauth', async () => {
  const res = await startGoogleOAuth()
  if (res.success) {
    await scheduleNextPoll()
  }
  return res
})

ipcMain.handle('logout-google-oauth', async () => {
  saveConfig({ geminiRefreshToken: '', geminiAccountEmail: '' })
  await scheduleNextPoll()
  return { success: true }
})

ipcMain.handle('get-codex-auth-status', () => getCodexAuthStatus())

ipcMain.handle('start-codex-oauth', async () => {
  const res = await startCodexOAuth()
  if (res.success) {
    void scheduleNextPoll()
  }
  return res
})

ipcMain.handle('logout-codex-oauth', async () => {
  const res = logoutCodexOAuth()
  if (res.success) {
    void scheduleNextPoll()
  }
  return res
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
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})
