const { app, BrowserWindow } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion,TranslateUI,MediaRouter')
app.commandLine.appendSwitch('force-device-scale-factor', '2') // 2x 高清Retina渲染

const OUT_DIR = path.resolve(__dirname, '../../xiaoheihe')
if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true })
}

app.whenReady().then(async () => {
  // 生成带高颜值壁纸衬底的展示图，确保在任何Markdown查看器和深浅色模式下100%清晰呈现磨砂质感
  async function captureWithBackdrop(viewQuery, width, height, filename) {
    const padX = 40
    const padY = 40
    const win = new BrowserWindow({
      width: width + padX * 2,
      height: height + padY * 2,
      frame: false,
      show: false,
      backgroundColor: '#0b0f19', // 高级深邃桌面背景色
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: false
      }
    })

    // 加载页面并注入桌面背景样式包装
    const targetUrl = `file://${path.resolve(__dirname, '../dist/index.html').replace(/\\/g, '/')}?view=${viewQuery}`
    await win.loadURL(targetUrl)
    await new Promise((r) => setTimeout(r, 1200))

    // 调整视图在桌面背景正中央呈现并带柔和阴影
    await win.webContents.executeJavaScript(`
      document.body.style.backgroundColor = '#0b0f19';
      document.body.style.display = 'flex';
      document.body.style.alignItems = 'center';
      document.body.style.justifyContent = 'center';
      document.body.style.padding = '0';
      document.body.style.margin = '0';
      document.body.style.width = '100vw';
      document.body.style.height = '100vh';
      const root = document.getElementById('root');
      if (root) {
        root.style.width = '${width}px';
        root.style.height = '${height}px';
        root.style.boxShadow = '0 25px 60px -15px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.1)';
        root.style.borderRadius = '24px';
      }
    `)

    await new Promise((r) => setTimeout(r, 600))
    const img = await win.webContents.capturePage()
    fs.writeFileSync(path.join(OUT_DIR, filename), img.toPNG())
    console.log(`✓ ${filename} generated successfully`)
    win.close()
  }

  // 1. 生成主窗口截图
  await captureWithBackdrop('main', 470, 250, 'main.png')

  // 2. 生成日历窗口截图
  await captureWithBackdrop('calendar', 960, 620, 'calendar.png')

  // 3. 生成设置窗口截图
  await captureWithBackdrop('settings', 470, 250, 'settings.png')

  app.quit()
})
