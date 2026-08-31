import path from 'node:path'
import { app } from 'electron'

/**
 * 获取程序的安装根目录（绿色便携路径）
 * - 打包环境下：返回可执行文件 (.exe) 所在的完整安装目录
 * - 开发环境下：返回项目根目录
 */
export function getStorageDir(): string {
  if (app.isPackaged) {
    return path.dirname(process.execPath)
  }
  return path.resolve(app.getAppPath(), '..')
}
