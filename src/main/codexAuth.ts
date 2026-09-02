import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { app, safeStorage, shell } from 'electron'
import { parseCodexUsage, CodexQuotaData } from './codexUsage.js'
import { loadConfig, saveConfig } from './store.js'

const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const CODEX_AUTH_URL = 'https://auth.openai.com/oauth/authorize'
const CODEX_TOKEN_URL = 'https://auth.openai.com/oauth/token'
const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'
const CODEX_REDIRECT_PATH = '/auth/callback'
const CODEX_PORTS = [1455, 1457]
const TOKEN_TIMEOUT_MS = 15_000
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000
const LEGACY_AUTH_FILE_NAME = 'codex-auth.dat'

interface StoredCodexAuth {
  refreshToken: string
  accountId?: string
  email?: string
}

interface CodexSession extends StoredCodexAuth {
  accessToken: string
  expiresAt: number
}

export interface CodexAuthStatus {
  configured: boolean
  email?: string
  error?: string
}

let session: CodexSession | null = null
let refreshInFlight: { refreshToken: string; promise: Promise<CodexSession> } | null = null
let activeServer: http.Server | null = null
let cancelActiveLogin: (() => void) | null = null
let authRevision = 0

function legacyAuthFilePath(): string {
  return path.join(app.getPath('appData'), 'TokenMonitor', LEGACY_AUTH_FILE_NAME)
}

function decryptStoredAuth(encoded: string): { auth: StoredCodexAuth | null; error?: string } {
  if (!safeStorage.isEncryptionAvailable()) {
    return { auth: null, error: '系统安全存储不可用，无法读取 ChatGPT 授权' }
  }
  try {
    const parsed = JSON.parse(safeStorage.decryptString(Buffer.from(encoded, 'base64'))) as Partial<StoredCodexAuth>
    if (typeof parsed.refreshToken !== 'string' || !parsed.refreshToken) {
      return { auth: null, error: '本地 ChatGPT 授权凭证格式无效' }
    }
    return {
      auth: {
        refreshToken: parsed.refreshToken,
        accountId: typeof parsed.accountId === 'string' ? parsed.accountId : undefined,
        email: typeof parsed.email === 'string' ? parsed.email : undefined
      }
    }
  } catch {
    return { auth: null, error: '本地 ChatGPT 授权凭证无法解密' }
  }
}

function encodeStoredAuth(auth: StoredCodexAuth): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('系统安全存储不可用，未保存 ChatGPT 授权')
  }

  return safeStorage.encryptString(JSON.stringify(auth)).toString('base64')
}

function writeStoredAuth(auth: StoredCodexAuth): void {
  const encrypted = encodeStoredAuth(auth)
  const updated = saveConfig({ codexAuth: { encrypted } })
  if (updated.codexAuth?.encrypted !== encrypted) {
    throw new Error('ChatGPT 授权未能写入 config.json')
  }
}

function readStoredAuth(): { auth: StoredCodexAuth | null; error?: string } {
  const configAuth = loadConfig().codexAuth
  if (configAuth?.encrypted) {
    const result = decryptStoredAuth(configAuth.encrypted)
    if (result.auth) {
      fs.rmSync(legacyAuthFilePath(), { force: true })
      return result
    }
    if (!fs.existsSync(legacyAuthFilePath())) return result
  }

  const filePath = legacyAuthFilePath()
  if (!fs.existsSync(filePath)) return { auth: null }
  if (!safeStorage.isEncryptionAvailable()) {
    return { auth: null, error: '系统安全存储不可用，无法读取 ChatGPT 授权' }
  }

  try {
    const result = decryptStoredAuth(fs.readFileSync(filePath, 'utf8'))
    if (!result.auth) return result
    try {
      writeStoredAuth(result.auth)
      fs.rmSync(filePath, { force: true })
    } catch {}
    return result
  } catch {
    return { auth: null, error: '本地 ChatGPT 授权凭证无法读取' }
  }
}

function removeStoredAuth(): void {
  const updated = saveConfig({ codexAuth: undefined })
  if (updated.codexAuth) throw new Error('ChatGPT 授权未能从 config.json 移除')
  fs.rmSync(legacyAuthFilePath(), { force: true })
}

function jwtClaims(token: string): Record<string, unknown> {
  try {
    const payload = token.split('.')[1]
    if (!payload) return {}
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function claimString(claims: Record<string, unknown>, key: string): string | undefined {
  const direct = claims[key]
  if (typeof direct === 'string' && direct.trim()) return direct.trim()
  const auth = claims['https://api.openai.com/auth']
  if (auth && typeof auth === 'object' && !Array.isArray(auth)) {
    const nested = (auth as Record<string, unknown>)[key]
    if (typeof nested === 'string' && nested.trim()) return nested.trim()
  }
  return undefined
}

function tokenMetadata(accessToken: string, idToken?: string): Pick<StoredCodexAuth, 'accountId' | 'email'> {
  const idClaims = idToken ? jwtClaims(idToken) : {}
  const accessClaims = jwtClaims(accessToken)
  return {
    accountId: claimString(idClaims, 'chatgpt_account_id')
      || claimString(accessClaims, 'chatgpt_account_id'),
    email: claimString(idClaims, 'email') || claimString(accessClaims, 'email')
  }
}

function tokenExpiry(accessToken: string, expiresIn: unknown): number {
  const seconds = typeof expiresIn === 'number' && Number.isFinite(expiresIn) ? expiresIn : undefined
  if (seconds !== undefined && seconds > 0) return Date.now() + seconds * 1000

  const exp = jwtClaims(accessToken).exp
  if (typeof exp === 'number' && Number.isFinite(exp)) return exp * 1000
  return Date.now() + 5 * 60 * 1000
}

function sessionIsUsable(value: CodexSession): boolean {
  return value.expiresAt > Date.now() + 60_000
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new Error('请求已取消')
}

async function readJson<T>(response: Response, signal?: AbortSignal): Promise<T> {
  throwIfAborted(signal)
  const data = await response.json() as T
  throwIfAborted(signal)
  return data
}

function createRequestSignal(parent?: AbortSignal): {
  signal: AbortSignal
  cleanup: () => void
} {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('ChatGPT 请求超时')), TOKEN_TIMEOUT_MS)
  const abortFromParent = () => controller.abort(parent?.reason ?? new Error('请求已取消'))

  if (parent) {
    if (parent.aborted) {
      abortFromParent()
    } else {
      parent.addEventListener('abort', abortFromParent, { once: true })
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer)
      parent?.removeEventListener('abort', abortFromParent)
      controller.abort()
    }
  }
}

function safeErrorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

async function exchangeCode(code: string, verifier: string, redirectUri: string): Promise<CodexSession> {
  const revision = authRevision
  const request = createRequestSignal()
  try {
    const response = await fetch(CODEX_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json'
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: CODEX_CLIENT_ID,
        code_verifier: verifier
      }).toString(),
      signal: request.signal
    })

    throwIfAborted(request.signal)
    if (!response.ok) throw new Error(`ChatGPT OAuth HTTP ${response.status}`)
    const data = await readJson<Record<string, unknown>>(response, request.signal)
    const accessToken = typeof data.access_token === 'string' ? data.access_token : ''
    const refreshToken = typeof data.refresh_token === 'string' ? data.refresh_token : ''
    if (!accessToken || !refreshToken) throw new Error('ChatGPT OAuth 未返回完整授权凭证')

    const metadata = tokenMetadata(accessToken, typeof data.id_token === 'string' ? data.id_token : undefined)
    const nextSession: CodexSession = {
      accessToken,
      refreshToken,
      expiresAt: tokenExpiry(accessToken, data.expires_in),
      ...metadata
    }
    if (revision !== authRevision) throw new Error('登录状态已变更，请重试')
    writeStoredAuth({
      refreshToken: nextSession.refreshToken,
      accountId: nextSession.accountId,
      email: nextSession.email
    })
    session = nextSession
    return nextSession
  } finally {
    request.cleanup()
  }
}

async function refreshSession(source: StoredCodexAuth, parentSignal?: AbortSignal): Promise<CodexSession> {
  const revision = authRevision
  const request = createRequestSignal(parentSignal)
  try {
    const response = await fetch(CODEX_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({
        client_id: CODEX_CLIENT_ID,
        grant_type: 'refresh_token',
        refresh_token: source.refreshToken
      }),
      signal: request.signal
    })

    throwIfAborted(request.signal)
    if (!response.ok) throw new Error('ChatGPT 授权已过期，请重新登录')
    const data = await readJson<Record<string, unknown>>(response, request.signal)
    const accessToken = typeof data.access_token === 'string' ? data.access_token : ''
    if (!accessToken) throw new Error('ChatGPT 刷新授权失败，请重新登录')

    const metadata = tokenMetadata(accessToken, typeof data.id_token === 'string' ? data.id_token : undefined)
    const nextSession: CodexSession = {
      accessToken,
      refreshToken: typeof data.refresh_token === 'string' && data.refresh_token ? data.refresh_token : source.refreshToken,
      expiresAt: tokenExpiry(accessToken, data.expires_in),
      accountId: metadata.accountId || source.accountId,
      email: metadata.email || source.email
    }
    if (revision !== authRevision) throw new Error('登录状态已变更，请重试')
    writeStoredAuth({
      refreshToken: nextSession.refreshToken,
      accountId: nextSession.accountId,
      email: nextSession.email
    })
    session = nextSession
    return nextSession
  } finally {
    request.cleanup()
  }
}

function refreshSessionOnce(source: StoredCodexAuth, parentSignal?: AbortSignal): Promise<CodexSession> {
  if (session && session.refreshToken !== source.refreshToken) {
    if (sessionIsUsable(session)) return Promise.resolve(session)
    return refreshSessionOnce(session, parentSignal)
  }
  if (refreshInFlight?.refreshToken === source.refreshToken) return refreshInFlight.promise

  const promise = refreshSession(source, parentSignal)
  const pending = { refreshToken: source.refreshToken, promise }
  refreshInFlight = pending
  void promise.then(
    () => {
      if (refreshInFlight === pending) refreshInFlight = null
    },
    () => {
      if (refreshInFlight === pending) refreshInFlight = null
    }
  )
  return promise
}

async function ensureSession(stored: StoredCodexAuth, signal?: AbortSignal): Promise<CodexSession> {
  throwIfAborted(signal)
  if (session && session.refreshToken === stored.refreshToken && sessionIsUsable(session)) return session
  return refreshSessionOnce(session && session.refreshToken === stored.refreshToken ? session : stored, signal)
}

async function requestUsage(current: CodexSession, parentSignal?: AbortSignal): Promise<{
  response: Response
  signal: AbortSignal
  cleanup: () => void
}> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${current.accessToken}`,
    Accept: 'application/json',
    'User-Agent': 'TokenMonitor'
  }
  if (current.accountId) headers['ChatGPT-Account-Id'] = current.accountId
  const request = createRequestSignal(parentSignal)
  try {
    const response = await fetch(CODEX_USAGE_URL, {
      method: 'GET',
      headers,
      signal: request.signal
    })
    throwIfAborted(request.signal)
    return { response, signal: request.signal, cleanup: request.cleanup }
  } catch (err) {
    request.cleanup()
    throw err
  }
}

export function getCodexAuthStatus(): CodexAuthStatus {
  if (session) return { configured: true, email: session.email }
  const stored = readStoredAuth()
  return {
    configured: !!stored.auth,
    email: stored.auth?.email,
    error: stored.error
  }
}

export async function fetchCodexQuota(signal?: AbortSignal): Promise<CodexQuotaData> {
  throwIfAborted(signal)
  const stored = readStoredAuth()
  if (!stored.auth) {
    throwIfAborted(signal)
    return { configured: false, error: stored.error || null }
  }

  try {
    let current = await ensureSession(stored.auth, signal)
    let usageRequest = await requestUsage(current, signal)

    try {
      if (usageRequest.response.status === 401) {
        usageRequest.cleanup()
        current = await refreshSessionOnce(current, signal)
        usageRequest = await requestUsage(current, signal)
      }

      const response = usageRequest.response
      if (!response.ok) {
        return {
          configured: true,
          email: current.email || stored.auth.email,
          error: response.status === 403
            ? 'ChatGPT 账号无权读取 Codex 额度'
            : `Codex 额度接口 HTTP ${response.status}`
        }
      }

      let payload: unknown
      try {
        payload = await readJson<unknown>(response, usageRequest.signal)
      } catch {
        throwIfAborted(signal)
        throw new Error('Codex 额度返回格式异常')
      }
      const parsed = parseCodexUsage(payload, current.email || stored.auth.email)
      return {
        ...parsed,
        configured: true,
        error: parsed.error || null
      }
    } finally {
      usageRequest.cleanup()
    }
  } catch (err: unknown) {
    throwIfAborted(signal)
    return {
      configured: true,
      email: session?.email || stored.auth.email,
      error: safeErrorMessage(err, 'Codex 网络连接异常')
    }
  }
}

function htmlResponse(res: http.ServerResponse, status: number, body: string): void {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'"
  })
  res.end(body)
}

function loginPage(success: boolean): string {
  const title = success ? 'ChatGPT 授权成功' : 'ChatGPT 授权失败'
  const message = success
    ? '已成功绑定 ChatGPT 账号，可以关闭此页面并返回 TokenMonitor。'
    : '授权未完成，请返回 TokenMonitor 重试。'
  const color = success ? '#4ade80' : '#f87171'
  return `<html><body style="background:#0f172a;color:#e2e8f0;font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh"><main style="background:#1e293b;padding:32px 48px;border-radius:20px;text-align:center;border:1px solid rgba(255,255,255,.1)"><h2 style="color:${color}">${title}</h2><p>${message}</p></main></body></html>`
}

async function listenOnPort(handler: http.RequestListener): Promise<{ server: http.Server; port: number }> {
  let lastError: unknown
  for (const port of CODEX_PORTS) {
    const server = http.createServer(handler)
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (err: Error) => {
          server.removeListener('listening', onListening)
          reject(err)
        }
        const onListening = () => {
          server.removeListener('error', onError)
          resolve()
        }
        server.once('error', onError)
        server.once('listening', onListening)
        server.listen(port, '127.0.0.1')
      })
      return { server, port }
    } catch (err) {
      lastError = err
      try {
        server.close()
      } catch {}
      if ((err as NodeJS.ErrnoException)?.code !== 'EADDRINUSE') break
    }
  }
  throw lastError instanceof Error ? lastError : new Error('无法启动 ChatGPT OAuth 回调服务')
}

export function startCodexOAuth(): Promise<{ success: boolean; email?: string; error?: string }> {
  cancelActiveLogin?.()
  authRevision += 1

  return new Promise((resolve) => {
    let settled = false
    let callbackProcessing = false
    let server: http.Server | null = null
    let loginTimer: ReturnType<typeof setTimeout> | null = null
    let cancel: () => void
    const finish = (result: { success: boolean; email?: string; error?: string }) => {
      if (settled) return
      settled = true
      if (!result.success) authRevision += 1
      if (loginTimer) clearTimeout(loginTimer)
      if (cancelActiveLogin === cancel) cancelActiveLogin = null
      if (activeServer === server) activeServer = null
      try {
        server?.close()
      } catch {}
      resolve(result)
    }
    cancel = () => finish({ success: false, error: '登录已取消' })
    cancelActiveLogin = cancel

    const state = randomBytes(32).toString('base64url')
    const verifier = randomBytes(64).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest().toString('base64url')
    let callbackPort = CODEX_PORTS[0]

    const handler: http.RequestListener = async (req, res) => {
      if (settled) {
        htmlResponse(res, 410, 'Login session expired')
        return
      }
      if (req.method !== 'GET') {
        htmlResponse(res, 405, 'Method Not Allowed')
        return
      }

      let url: URL
      try {
        url = new URL(req.url || '', `http://localhost:${callbackPort}`)
      } catch {
        htmlResponse(res, 400, 'Bad Request')
        return
      }

      if (url.pathname !== CODEX_REDIRECT_PATH) {
        htmlResponse(res, 404, 'Not Found')
        return
      }

      if (url.searchParams.get('state') !== state) {
        htmlResponse(res, 400, loginPage(false))
        return
      }

      if (callbackProcessing) {
        htmlResponse(res, 409, 'Login callback already processed')
        return
      }
      callbackProcessing = true

      if (url.searchParams.get('error') || !url.searchParams.get('code')) {
        htmlResponse(res, 200, loginPage(false))
        finish({ success: false, error: 'ChatGPT OAuth 授权被取消或失败' })
        return
      }

      try {
        const redirectUri = `http://localhost:${callbackPort}${CODEX_REDIRECT_PATH}`
        const nextSession = await exchangeCode(url.searchParams.get('code') as string, verifier, redirectUri)
        htmlResponse(res, 200, loginPage(true))
        finish({ success: true, email: nextSession.email })
      } catch (err) {
        htmlResponse(res, 500, loginPage(false))
        finish({ success: false, error: safeErrorMessage(err, 'ChatGPT OAuth 登录失败') })
      }
    }

    void (async () => {
      try {
        const bound = await listenOnPort(handler)
        if (settled) {
          bound.server.close()
          return
        }
        server = bound.server
        callbackPort = bound.port
        activeServer = server
        loginTimer = setTimeout(() => {
          finish({ success: false, error: 'ChatGPT OAuth 登录超时，请重试' })
        }, LOGIN_TIMEOUT_MS)

        const redirectUri = `http://localhost:${callbackPort}${CODEX_REDIRECT_PATH}`
        const authUrl = new URL(CODEX_AUTH_URL)
        authUrl.search = new URLSearchParams({
          response_type: 'code',
          client_id: CODEX_CLIENT_ID,
          redirect_uri: redirectUri,
          scope: 'openid profile email offline_access api.connectors.read api.connectors.invoke',
          code_challenge: challenge,
          code_challenge_method: 'S256',
          id_token_add_organizations: 'true',
          codex_cli_simplified_flow: 'true',
          state,
          originator: 'codex_cli_rs'
        }).toString()
        await shell.openExternal(authUrl.toString())
      } catch (err) {
        finish({ success: false, error: safeErrorMessage(err, '无法启动 ChatGPT OAuth 登录') })
      }
    })()
  })
}

export function logoutCodexOAuth(): { success: boolean; error?: string } {
  cancelActiveLogin?.()
  authRevision += 1
  session = null
  refreshInFlight = null
  activeServer?.close()
  activeServer = null
  try {
    removeStoredAuth()
    return { success: true }
  } catch (err) {
    return { success: false, error: safeErrorMessage(err, '退出 ChatGPT 授权失败') }
  }
}
