import path from 'node:path'
import fs from 'node:fs'
import { getStorageDir } from './paths.js'

export interface AppConfig {
  apiKey: string // 兼容旧版，对应 opencodeApiKey
  opencodeApiKey?: string
  deepseekApiKey?: string
  geminiRefreshToken?: string
  geminiAccountEmail?: string
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
  activePlanIndex: 0
}

function getConfigPath(): string {
  return path.join(getStorageDir(), 'config.json')
}

export function loadConfig(): AppConfig {
  const configPath = getConfigPath()
  try {
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf-8')
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
