const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  fetchUsageNow: () => ipcRenderer.invoke('fetch-usage-now'),
  getTodayStats: () => ipcRenderer.invoke('get-today-stats'),
  getCalendarStats: (year, month) => ipcRenderer.invoke('get-calendar-stats', year, month),
  getAccountState: () => ipcRenderer.invoke('get-account-state'),
  saveApiAccount: (provider, name, apiKey, accountId) => ipcRenderer.invoke('save-api-account', provider, name, apiKey, accountId),
  renameAccount: (provider, accountId, name) => ipcRenderer.invoke('rename-account', provider, accountId, name),
  deleteAccount: (provider, accountId) => ipcRenderer.invoke('delete-account', provider, accountId),
  setActiveAccount: (provider, accountId) => ipcRenderer.invoke('set-active-account', provider, accountId),
  setOverlay: (mode) => ipcRenderer.invoke('set-overlay', mode),
  concealWindow: () => ipcRenderer.invoke('conceal-window'),
  prepareOverlay: (mode) => ipcRenderer.invoke('prepare-overlay', mode),
  revealOverlay: () => ipcRenderer.invoke('reveal-overlay'),
  startGoogleOAuth: () => ipcRenderer.invoke('start-google-oauth'),
  logoutGoogleOAuth: (accountId) => ipcRenderer.invoke('logout-google-oauth', accountId),
  getCodexAuthStatus: () => ipcRenderer.invoke('get-codex-auth-status'),
  startCodexOAuth: () => ipcRenderer.invoke('start-codex-oauth'),
  logoutCodexOAuth: (accountId) => ipcRenderer.invoke('logout-codex-oauth', accountId),
  openSettingsWindow: () => ipcRenderer.send('open-settings-window'),
  openCalendarWindow: () => ipcRenderer.send('open-calendar-window'),
  closeCurrentWindow: () => ipcRenderer.send('close-current-window'),
  setAlwaysOnTop: (flag) => ipcRenderer.invoke('set-always-on-top', flag),
  setOpacity: (val) => ipcRenderer.invoke('set-opacity', val),
  setIgnoreMouseEvents: (ignore) => ipcRenderer.invoke('set-ignore-mouse-events', ignore),
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  closeWindow: () => ipcRenderer.send('window-close'),
  onOpenOverlay: (callback) => {
    const handler = (_event, mode) => callback(mode)
    ipcRenderer.on('open-overlay', handler)
    return () => ipcRenderer.removeListener('open-overlay', handler)
  },
  onClickThroughChanged: (callback) => {
    const handler = (_event, val) => callback(val)
    ipcRenderer.on('click-through-changed', handler)
    return () => ipcRenderer.removeListener('click-through-changed', handler)
  },
  onUsageUpdate: (callback) => {
    const handler = (_event, data, complete = true) => callback(data, complete)
    ipcRenderer.on('usage-update', handler)
    return () => ipcRenderer.removeListener('usage-update', handler)
  }
})
