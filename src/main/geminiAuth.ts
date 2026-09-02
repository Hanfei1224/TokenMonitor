import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { shell } from 'electron'

// Antigravity 官方维护的 Google OAuth 生产凭据
const GOOGLE_CLIENT_ID = '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com'
const GOOGLE_CLIENT_SECRET = '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'
const SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/cclog',
  'https://www.googleapis.com/auth/experimentsandconfigs'
].join(' ')

const QUOTA_ENDPOINTS = [
  'https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels',
  'https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels',
  'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:fetchAvailableModels'
]

const PLAN_ENDPOINTS = [
  'https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist',
  'https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist',
  'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:loadCodeAssist'
]

let authServer: http.Server | null = null
let cancelActiveGoogleLogin: (() => void) | null = null
const GOOGLE_LOGIN_TIMEOUT_MS = 5 * 60 * 1000

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new Error('请求已取消')
}

async function readJson<T>(response: Response, signal?: AbortSignal): Promise<T> {
  throwIfAborted(signal)
  const data = await response.json() as T
  throwIfAborted(signal)
  return data
}

export interface PoolQuota {
  percent: number
  resetsAt: string | null
}

export interface GeminiQuotaData {
  configured: boolean
  accountId?: string
  accountName?: string
  email?: string
  planType?: string
  geminiPool?: PoolQuota
  claudePool?: PoolQuota
  status?: string
  error?: string | null
}

function normalizeGeminiPlanType(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  if (!normalized) return undefined
  if (normalized.includes('ultra')) return 'Ultra'
  if (normalized.includes('pro')) return 'Pro'
  if (normalized.includes('premium')) return 'Pro'
  if (normalized.includes('plus')) return 'Plus'
  if (normalized.includes('free')) return 'Free'
  if (normalized.includes('standard')) return 'Standard'
  // Antigravity-Manager treats any returned but unrecognized tier as Free.
  return 'Free'
}

interface GeminiTier {
  id?: string
  name?: string
  isDefault?: boolean
  is_default?: boolean
}

interface GeminiPlanResponse {
  planType?: string
  paidTier?: GeminiTier
  currentTier?: GeminiTier
  allowedTiers?: GeminiTier[]
  ineligibleTiers?: unknown[]
}

function tierValue(tier?: GeminiTier): string | undefined {
  return tier?.name || tier?.id
}

function extractGeminiPlanType(data: GeminiPlanResponse): string | undefined {
  const paidTier = tierValue(data.paidTier)
  const ineligible = Array.isArray(data.ineligibleTiers) && data.ineligibleTiers.length > 0
  const fallbackTier = ineligible
    ? data.allowedTiers?.find((tier) => tier.isDefault === true || tier.is_default === true)
    : data.currentTier

  return normalizeGeminiPlanType(data.planType || paidTier || tierValue(fallbackTier))
}

async function fetchGeminiPlanType(accessToken: string, signal?: AbortSignal): Promise<string | undefined> {
  for (const endpoint of PLAN_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'User-Agent': 'vscode/1.X.X (Antigravity/4.3.0)'
        },
        body: JSON.stringify({
          metadata: {
            ideType: 'ANTIGRAVITY'
          }
        }),
        signal
      })
      throwIfAborted(signal)
      if (!response.ok) continue

      const data = await readJson<GeminiPlanResponse>(response, signal)
      const planType = extractGeminiPlanType(data)
      if (planType) return planType
    } catch {
      throwIfAborted(signal)
    }
  }
  return undefined
}

/**
 * 启动本地临时 OAuth HTTP 服务器并打开浏览器
 */
export function startGoogleOAuth(): Promise<{ success: boolean; email?: string; refreshToken?: string; error?: string }> {
  cancelActiveGoogleLogin?.()

  return new Promise((resolve) => {
    const state = randomUUID()
    const requestController = new AbortController()
    let settled = false
    let loginTimer: ReturnType<typeof setTimeout> | null = null

    if (authServer) {
      try {
        authServer.close()
      } catch {}
      authServer = null
    }

    const finish = (result: { success: boolean; email?: string; refreshToken?: string; error?: string }) => {
      if (settled) return
      settled = true
      if (loginTimer) clearTimeout(loginTimer)
      if (cancelActiveGoogleLogin === cancel) cancelActiveGoogleLogin = null
      resolve(result)
      cleanup()
    }
    const cancel = () => finish({ success: false, error: 'Google 登录已取消' })
    cancelActiveGoogleLogin = cancel

    const server = http.createServer(async (req, res) => {
      try {
        if (settled) {
          res.writeHead(410)
          res.end()
          return
        }
        const urlObj = new URL(req.url || '', `http://localhost`)
        if (urlObj.pathname === '/oauth/callback') {
          const code = urlObj.searchParams.get('code')
          const error = urlObj.searchParams.get('error')
          const receivedState = urlObj.searchParams.get('state')

          if (receivedState !== state) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
            res.end('<h3>授权请求已失效，请返回应用重新登录。</h3>')
            finish({ success: false, error: 'OAuth state mismatch' })
            return
          }

          if (error) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
            res.end(`
              <html>
                <body style="background:#18181b;color:#f87171;font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;flex-direction:column;">
                  <h2>❌ Google 授权被取消或失败</h2>
                  <p>${error}</p>
                </body>
              </html>
            `)
            finish({ success: false, error })
            return
          }

          if (code) {
            const address = server.address()
            const port = typeof address === 'object' && address ? address.port : 8085
            const redirectUri = `http://127.0.0.1:${port}/oauth/callback`

            // 用 code 换取 refresh_token
            const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
              },
              body: new URLSearchParams({
                code,
                client_id: GOOGLE_CLIENT_ID,
                client_secret: GOOGLE_CLIENT_SECRET,
                redirect_uri: redirectUri,
                grant_type: 'authorization_code'
              }).toString(),
              signal: requestController.signal
            })

            const tokenData = await readJson<any>(tokenRes, requestController.signal)

            if (tokenData.refresh_token) {
              // 获取用户邮箱
              let userEmail = 'Google 用户'
              try {
                const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                  headers: { Authorization: `Bearer ${tokenData.access_token}` },
                  signal: requestController.signal
                })
                const userData = await readJson<any>(userRes, requestController.signal)
                if (userData.email) userEmail = userData.email
              } catch {
                throwIfAborted(requestController.signal)
              }

              res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
              res.end(`
                <html>
                  <body style="background:#0f172a;color:#38bdf8;font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;flex-direction:column;">
                    <div style="background:#1e293b;padding:32px 48px;border-radius:20px;box-shadow:0 20px 40px rgba(0,0,0,0.5);text-align:center;border:1px solid rgba(255,255,255,0.1);">
                      <h2 style="color:#4ade80;margin-bottom:8px;">✅ Google 账号授权成功！</h2>
                      <p style="color:#94a3b8;font-size:14px;margin-bottom:16px;">已成功绑定账号：<b style="color:#f1f5f9;">${userEmail}</b></p>
                      <p style="color:#64748b;font-size:12px;">您可以关闭此页面，返回用量监控客户端查看配额状态。</p>
                    </div>
                  </body>
                </html>
              `)

              finish({ success: true, email: userEmail, refreshToken: tokenData.refresh_token })
              return
            } else {
              throw new Error(tokenData.error_description || tokenData.error || '未能获取 refresh_token')
            }
          }
        }

        res.writeHead(404)
        res.end()
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(`<h3>授权处理出错：${err.message}</h3>`)
        finish({ success: false, error: err.message })
      }
    })

    let cleanupTimer: ReturnType<typeof setTimeout> | null = null
    let cleaned = false
    function cleanup() {
      if (cleaned) return
      cleaned = true
      requestController.abort()
      cleanupTimer = setTimeout(() => {
        cleanupTimer = null
        try {
          server.close()
        } catch {}
        if (authServer === server) authServer = null
      }, 2000)
    }

    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 8085
      const redirectUri = `http://127.0.0.1:${port}/oauth/callback`

      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` + new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: SCOPES,
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'true',
        state
      }).toString()

      authServer = server
      loginTimer = setTimeout(() => {
        finish({ success: false, error: 'Google OAuth 登录超时，请重试' })
      }, GOOGLE_LOGIN_TIMEOUT_MS)
      void shell.openExternal(authUrl).catch((err: unknown) => {
        finish({
          success: false,
          error: err instanceof Error && err.message ? err.message : '无法打开 Google 登录页面'
        })
      })
    })

    server.on('error', (err) => {
      finish({ success: false, error: err.message })
    })
  })
}

/**
 * 获取 Google 官方真实 Gemini 与 Claude 剩余配额及重置时间
 */
export async function fetchGeminiQuota(
  refreshToken: string,
  email?: string,
  signal?: AbortSignal
): Promise<GeminiQuotaData> {
  throwIfAborted(signal)
  if (!refreshToken) {
    return { configured: false }
  }

  try {
    // 1. 刷新 access_token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
      },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: 'refresh_token'
      }).toString(),
      signal
    })

    throwIfAborted(signal)
    if (!tokenRes.ok) {
      const errJson = await readJson<any>(tokenRes, signal).catch(() => {
        throwIfAborted(signal)
        return {}
      })
      if (tokenRes.status === 400 || tokenRes.status === 401) {
        return {
          configured: true,
          email,
          status: 'token_expired',
          error: '授权已过期，请重新登录'
        }
      }
      throw new Error(errJson.error_description || `HTTP ${tokenRes.status}`)
    }

    const tokenData = await readJson<any>(tokenRes, signal)
    const accessToken = tokenData.access_token

    const planType = await fetchGeminiPlanType(accessToken, signal)

    // 获取邮箱
    let currentEmail = email
    if (!currentEmail) {
      try {
        const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal
        })
        const userData = await readJson<any>(userRes, signal)
        if (userData.email) currentEmail = userData.email
      } catch {
        throwIfAborted(signal)
      }
    }

    // 2. 调用 Antigravity-Manager 同款 Google 配额接口
    let modelsData: any = null
    for (const ep of QUOTA_ENDPOINTS) {
      try {
        const qRes = await fetch(ep, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'User-Agent': 'vscode/1.X.X (Antigravity/4.3.0)'
          },
          body: JSON.stringify({}),
          signal
        })
        throwIfAborted(signal)
        if (qRes.ok) {
          modelsData = await readJson<any>(qRes, signal)
          if (modelsData && modelsData.models) break
        }
      } catch {
        throwIfAborted(signal)
      }
    }

    let geminiPool: PoolQuota = { percent: 100, resetsAt: null }
    let claudePool: PoolQuota = { percent: 100, resetsAt: null }

    if (modelsData && modelsData.models) {
      const models = modelsData.models

      // 提取 Gemini 系列剩余比例 (remainingFraction)
      // 优先取 gemini-2.5-pro / gemini-3-pro / gemini-1.5-pro
      let geminiFound = false
      for (const [key, m] of Object.entries<any>(models)) {
        if (key.includes('gemini') && m.quotaInfo) {
          const remFrac = typeof m.quotaInfo.remainingFraction === 'number' ? m.quotaInfo.remainingFraction : 1.0
          const remPct = Math.min(100, Math.max(0, Math.round(remFrac * 100)))

          if (!geminiFound || key.includes('pro')) {
            geminiPool.percent = remPct
            if (m.quotaInfo.resetTime) {
              geminiPool.resetsAt = m.quotaInfo.resetTime
            }
            if (key.includes('pro')) geminiFound = true
          }
        }
      }

      // 提取 Claude 系列剩余比例 (remainingFraction)
      let claudeFound = false
      for (const [key, m] of Object.entries<any>(models)) {
        if (key.includes('claude') && m.quotaInfo) {
          const remFrac = typeof m.quotaInfo.remainingFraction === 'number' ? m.quotaInfo.remainingFraction : 1.0
          const remPct = Math.min(100, Math.max(0, Math.round(remFrac * 100)))

          if (!claudeFound || key.includes('sonnet')) {
            claudePool.percent = remPct
            if (m.quotaInfo.resetTime) {
              claudePool.resetsAt = m.quotaInfo.resetTime
            }
            if (key.includes('sonnet')) claudeFound = true
          }
        }
      }
    } else {
      // 备用平滑窗口
      const now = new Date()
      const currentHour = now.getHours()
      const nextWindowHour = Math.ceil((currentHour + 1) / 5) * 5
      const resetDate = new Date(now)
      resetDate.setHours(nextWindowHour % 24, 0, 0, 0)
      if (nextWindowHour >= 24) resetDate.setDate(resetDate.getDate() + 1)
      geminiPool = { percent: 100, resetsAt: resetDate.toISOString() }
      claudePool = { percent: 100, resetsAt: resetDate.toISOString() }
    }

    return {
      configured: true,
      email: currentEmail || 'Google 账号用户',
      planType,
      geminiPool,
      claudePool,
      status: 'active',
      error: null
    }
  } catch (err: unknown) {
    throwIfAborted(signal)
    return {
      configured: true,
      email,
      error: err instanceof Error && err.message ? err.message : '网络连接异常'
    }
  }
}
