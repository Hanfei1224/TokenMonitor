'use strict'

// Keep this console open: never let Electron's exit tear down Vite,
// and never pass extra args like `-e` to electron.exe.
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const logPath = path.resolve(root, '..', 'startup.log')
const electronBin = require('electron')
const VITE_CANDIDATES = [
  'http://localhost:5173/',
  'http://127.0.0.1:5173/',
  'http://[::1]:5173/'
]

function stamp() {
  return new Date().toISOString().replace('T', ' ').replace('Z', '')
}

function writeLog(line) {
  try {
    fs.appendFileSync(logPath, `[${stamp()}] ${line}\n`, 'utf8')
  } catch {
    // ignore log write failures
  }
}

function log(msg) {
  const line = `[dev-app] ${msg}`
  console.log(line)
  writeLog(line)
}

function logErr(msg) {
  const line = `[dev-app] ${msg}`
  console.error(line)
  writeLog(line)
}

try {
  if (!fs.existsSync(logPath)) fs.writeFileSync(logPath, '\uFEFF', 'utf8')
} catch {
  // ignore
}

writeLog('======== 启动 ========')
writeLog(`cwd=${process.cwd()}`)
writeLog(`root=${root}`)
writeLog(`node=${process.execPath} ${process.version}`)
writeLog(`electronBin=${electronBin}`)
writeLog(`argv=${JSON.stringify(process.argv)}`)

function pingOnce(url, timeoutMs = 800) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume()
      resolve(true)
    })
    req.on('error', () => resolve(false))
    req.setTimeout(timeoutMs, () => {
      req.destroy()
      resolve(false)
    })
  })
}

async function findVite() {
  for (const url of VITE_CANDIDATES) {
    if (await pingOnce(url)) return url.replace(/\/$/, '')
  }
  return null
}

async function waitForVite(timeoutMs = 30000) {
  const started = Date.now()
  for (;;) {
    const url = await findVite()
    if (url) return url
    if (Date.now() - started > timeoutMs) {
      throw new Error('Vite 未在 30 秒内就绪 (localhost:5173)')
    }
    await new Promise((r) => setTimeout(r, 300))
  }
}

function pipeChild(child, name) {
  const onChunk = (buf) => {
    const text = buf.toString()
    process.stdout.write(text)
    writeLog(text.replace(/\s+$/, ''))
  }
  child.stdout?.on('data', onChunk)
  child.stderr?.on('data', (buf) => {
    const text = buf.toString()
    process.stderr.write(text)
    writeLog(`[${name}:err] ${text.replace(/\s+$/, '')}`)
  })
}

function spawnChild(command, args, extra = {}) {
  log(`spawn ${command} ${args.join(' ')}`)
  const child = spawn(command, args, {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    shell: false,
    env: process.env,
    ...extra
  })
  child.on('error', (err) => {
    logErr(`spawn error: ${err.stack || err.message}`)
  })
  return child
}

async function main() {
  let viteChild = null
  let electronChild = null
  let shuttingDown = false

  let viteUrl = await findVite()
  if (viteUrl) {
    log(`复用已在运行的 Vite ${viteUrl}`)
  } else {
    log('启动 Vite...')
    viteChild = spawnChild(process.execPath, [
      path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')
    ])
    pipeChild(viteChild, 'vite')
    viteChild.on('exit', (code) => {
      if (!shuttingDown) log(`Vite 已退出 code=${code}`)
    })
    viteUrl = await waitForVite()
    log(`Vite 已就绪 ${viteUrl}`)
  }

  log('启动窗口...')
  electronChild = spawnChild(electronBin, ['.'], {
    env: { ...process.env, ELECTRON_RENDERER_URL: viteUrl }
  })
  pipeChild(electronChild, 'electron')
  electronChild.on('exit', (code, signal) => {
    log(`窗口已退出 code=${code ?? 'null'} signal=${signal || '-'}`)
    log(`完整日志: ${logPath}`)
    log('这个窗口不会自动关。看完日志后按任意键关闭。')
    process.stdin.resume()
  })

  const shutdown = () => {
    if (shuttingDown) return
    shuttingDown = true
    if (electronChild && !electronChild.killed) electronChild.kill()
    if (viteChild && !viteChild.killed) viteChild.kill()
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err) => {
  logErr(`启动失败: ${err.stack || err.message}`)
  log(`完整日志: ${logPath}`)
  log('这个窗口不会自动关。看完后按任意键关闭。')
  process.stdin.resume()
})
