import path from 'node:path'

export function resolveStorageDir(isPackaged: boolean, executablePath: string, appPath: string): string {
  if (isPackaged) return path.dirname(executablePath)
  return path.resolve(appPath, '..', '.dev-data')
}
