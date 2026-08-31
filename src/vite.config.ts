import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import { defineConfig, type Plugin } from 'vite'
import path from 'node:path'
import fs from 'node:fs'

function rawPreloadPlugin(): Plugin {
  return {
    name: 'raw-preload-plugin',
    closeBundle() {
      const srcPath = path.resolve(__dirname, 'preload/index.cjs')
      const destDir = path.resolve(__dirname, 'dist-electron/preload')
      const destPath = path.resolve(destDir, 'index.cjs')
        if (fs.existsSync(srcPath)) {
        if (!fs.existsSync(destDir)) {
          fs.mkdirSync(destDir, { recursive: true })
        }
        fs.copyFileSync(srcPath, destPath)
        console.log('[Vite] Synced pure CommonJS preload to dist-electron/preload/index.cjs')
      }
      const workerSrc = path.resolve(__dirname, 'main/sqlite-worker.cjs')
      const workerDestDir = path.resolve(__dirname, 'dist-electron/main')
      if (fs.existsSync(workerSrc)) {
        if (!fs.existsSync(workerDestDir)) {
          fs.mkdirSync(workerDestDir, { recursive: true })
        }
        fs.copyFileSync(workerSrc, path.join(workerDestDir, 'sqlite-worker.cjs'))
      }

      // 同步 sql.js 的 wasm 核心引擎至编译产物目录
      const wasmSrc = path.resolve(__dirname, 'node_modules/sql.js/dist/sql-wasm.wasm')
      if (fs.existsSync(wasmSrc)) {
        if (!fs.existsSync(workerDestDir)) {
          fs.mkdirSync(workerDestDir, { recursive: true })
        }
        fs.copyFileSync(wasmSrc, path.join(workerDestDir, 'sql-wasm.wasm'))
        console.log('[Vite] Synced sql-wasm.wasm to dist-electron/main/sql-wasm.wasm')
      }
    }
  }
}

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true
  },
  plugins: [
    react(),
    electron([
      {
        entry: 'main/index.ts',
        onstart() {
          // 不在这里拉起 Electron：Windows 上插件会立刻 taskkill 子进程并把 Vite 一起带走
        },
        vite: {
          build: {
            outDir: 'dist-electron/main',
            rollupOptions: {
              external: ['electron', 'better-sqlite3', 'sql.js']
            }
          }
        }
      }
    ]),
    renderer(),
    rawPreloadPlugin()
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'renderer')
    }
  }
})
