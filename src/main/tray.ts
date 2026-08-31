import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, Menu, Tray, nativeImage } from 'electron'
import { loadConfig, saveConfig } from './store.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let tray: Tray | null = null

function getTrayIcon(): ReturnType<typeof nativeImage.createEmpty> {
  const possiblePaths = [
    path.join(app.getAppPath(), 'icon.ico'),
    path.join(app.getAppPath(), 'icon.png'),
    path.join(process.resourcesPath, 'icon.ico'),
    path.join(process.resourcesPath, 'icon.png'),
    path.join(process.resourcesPath, 'app.asar.unpacked', 'icon.ico'),
    path.join(__dirname, '../icon.ico'),
    path.join(__dirname, '../icon.png'),
    path.join(__dirname, '../../icon.ico'),
    path.join(__dirname, '../../icon.png'),
    path.resolve(process.cwd(), 'icon.ico'),
    path.resolve(process.cwd(), 'icon.png'),
    path.resolve(process.cwd(), 'src/icon.ico'),
    path.resolve(process.cwd(), 'src/icon.png')
  ]
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      const img = nativeImage.createFromPath(p)
      if (!img.isEmpty()) return img
    }
  }
  return nativeImage.createEmpty()
}

function showMain(win: BrowserWindow) {
  win.setSkipTaskbar(true)
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

export function createTray(
  win: BrowserWindow,
  actions: {
    refresh: () => void
    openSettings: () => void
  }
): Tray {
  const icon = getTrayIcon()
  tray = new Tray(icon)
  tray.setToolTip(`TokenMonitor ${app.getVersion()}`)

  tray.on('click', () => showMain(win))

  tray.on('right-click', () => {
    const cfg = loadConfig()
    const menu = Menu.buildFromTemplate([
      {
        label: '显示窗口',
        click: () => showMain(win)
      },
      { type: 'separator' },
      {
        label: '立即刷新',
        click: () => actions.refresh()
      },
      {
        label: '鼠标穿透',
        type: 'checkbox',
        checked: !!cfg.clickThrough,
        click: (item) => {
          win.setIgnoreMouseEvents(item.checked, { forward: true })
          saveConfig({ clickThrough: item.checked })
          win.webContents.send('click-through-changed', item.checked)
        }
      },
      {
        label: '窗口置顶',
        type: 'checkbox',
        checked: cfg.alwaysOnTop ?? true,
        click: (item) => {
          win.setAlwaysOnTop(item.checked)
          saveConfig({ alwaysOnTop: item.checked })
        }
      },
      {
        label: '设置',
        click: () => actions.openSettings()
      },
      { type: 'separator' },
      {
        label: '退出 TokenMonitor',
        click: () => {
          app.quit()
        }
      }
    ])
    tray?.popUpContextMenu(menu)
  })

  return tray
}
