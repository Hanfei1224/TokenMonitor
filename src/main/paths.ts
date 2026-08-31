import path from 'node:path'
import { app } from 'electron'
import { resolveStorageDir } from './storagePath.js'

/**
 * 获取持久化数据目录。
 * - 安装环境：使用可执行文件所在的安装目录
 * - 开发环境：使用工作区固定的 .dev-data 目录
 */
export function getStorageDir(): string {
  return resolveStorageDir(app.isPackaged, process.execPath, app.getAppPath())
}

export function getLegacyDevStorageDir(): string | null {
  if (app.isPackaged) return null
  return path.resolve(app.getAppPath(), '..')
}
