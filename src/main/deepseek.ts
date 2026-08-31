import fs from 'node:fs'
import path from 'node:path'
import { getStorageDir } from './paths.js'

export interface DeepSeekBalanceData {
  configured: boolean
  is_available?: boolean
  balance?: number
  currency?: string
  startBalance?: number
  usedPercent?: number
  error?: string | null
}

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/user/balance'

function getCacheFilePath(): string {
  return path.join(getStorageDir(), 'deepseek_daily.json')
}

interface DailyCache {
  date: string
  startBalance: number
}

function getTodayDateStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function getOrSetStartBalance(currentBalance: number): number {
  const today = getTodayDateStr()
  const cacheFile = getCacheFilePath()
  try {
    if (fs.existsSync(cacheFile)) {
      const data: DailyCache = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'))
      if (data.date === today && typeof data.startBalance === 'number' && data.startBalance > 0) {
        // 如果充值导致余额增加，更新今日基准
        if (currentBalance > data.startBalance) {
          fs.writeFileSync(cacheFile, JSON.stringify({ date: today, startBalance: currentBalance }), 'utf-8')
          return currentBalance
        }
        return data.startBalance
      }
    }
  } catch {}

  // 记录今日初始余额
  try {
    fs.writeFileSync(cacheFile, JSON.stringify({ date: today, startBalance: currentBalance }), 'utf-8')
  } catch {}
  return currentBalance
}

export async function fetchDeepSeekBalance(apiKey: string): Promise<DeepSeekBalanceData> {
  if (!apiKey) {
    return { configured: false }
  }

  try {
    const res = await fetch(DEEPSEEK_BASE_URL, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json'
      }
    })

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        return { configured: true, error: 'API Key 无效或过期' }
      }
      return { configured: true, error: `HTTP ${res.status}` }
    }

    const json = await res.json()
    const info = json.balance_infos?.[0]
    if (!info) {
      return { configured: true, is_available: json.is_available, error: '未获取到余额信息' }
    }

    const totalBalance = parseFloat(info.total_balance || '0')
    const startBalance = getOrSetStartBalance(totalBalance)

    let usedPercent = 0
    if (startBalance > 0 && totalBalance <= startBalance) {
      usedPercent = Math.min(100, Math.max(0, Math.round(((startBalance - totalBalance) / startBalance) * 100)))
    }

    return {
      configured: true,
      is_available: json.is_available,
      balance: totalBalance,
      currency: info.currency || 'CNY',
      startBalance,
      usedPercent,
      error: null
    }
  } catch (err: any) {
    return {
      configured: true,
      error: err.message || '网络连接异常'
    }
  }
}
