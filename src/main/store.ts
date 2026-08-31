import path from 'node:path'
import fs from 'node:fs'
import { getLegacyDevStorageDir, getStorageDir } from './paths.js'

export interface AppConfig {
  apiKey: string // 兼容旧版，对应 opencodeApiKey
  opencodeApiKey?: string
  deepseekApiKey?: string
  geminiRefreshToken?: string
  geminiAccountEmail?: string
  codexAuth?: {
    encrypted: string
  }
  alwaysOnTop: boolean
  clickThrough: boolean
  windowPosition?: { x: number; y: number }
  activePlanIndex?: number
}

const DEFAULT_CONFIG: AppConfig = {
  apiKey: '',
  opencodeApiKey: '',
  deepseekApiKey: '',
  geminiRefreshToken: '',
  geminiAccountEmail: '',
  alwaysOnTop: true,
  clickThrough: false,
  activePlanIndex: 3
}

function getConfigPath(): string {
  return path.join(getStorageDir(), 'config.json')
}

function getLegacyConfigPath(): string | null {
  const legacyDir = getLegacyDevStorageDir()
  return legacyDir ? path.join(legacyDir, 'config.json') : null
}

function migrateLegacyConfig(configPath: string, legacyConfigPath: string | null): void {
  if (!legacyConfigPath || fs.existsSync(configPath) || !fs.existsSync(legacyConfigPath)) return
  try {
    fs.copyFileSync(legacyConfigPath, configPath)
  } catch (err) {
    console.error('Failed to migrate development config:', err)
  }
}

export function loadConfig(): AppConfig {
  const configPath = getConfigPath()
  const legacyConfigPath = getLegacyConfigPath()
  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    migrateLegacyConfig(configPath, legacyConfigPath)
    const sourcePath = fs.existsSync(configPath)
      ? configPath
      : legacyConfigPath && fs.existsSync(legacyConfigPath)
        ? legacyConfigPath
        : null
    if (sourcePath) {
      const data = fs.readFileSync(sourcePath, 'utf-8')
      const parsed = JSON.parse(data)
      if (parsed.apiKey && !parsed.opencodeApiKey) {
        parsed.opencodeApiKey = parsed.apiKey
      }
      return { ...DEFAULT_CONFIG, ...parsed }
    }
  } catch (err) {
    console.error('Failed to load config:', err)
  }
  return { ...DEFAULT_CONFIG }
}

export function saveConfig(cfg: Partial<AppConfig>): AppConfig {
  const configPath = getConfigPath()
  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    const current = loadConfig()
    const updated = { ...current, ...cfg }
    if (updated.opencodeApiKey && !updated.apiKey) {
      updated.apiKey = updated.opencodeApiKey
    }
    fs.writeFileSync(configPath, JSON.stringify(updated, null, 2), 'utf-8')
    return updated
  } catch (err) {
    console.error('Failed to save config:', err)
    return loadConfig()
  }
}
