import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { resolveStorageDir } from './storagePath.ts'

test('keeps packaged storage beside the executable', () => {
  const executablePath = path.resolve('install', 'TokenMonitor', 'TokenMonitor.exe')
  assert.equal(resolveStorageDir(true, executablePath, 'unused'), path.dirname(executablePath))
})

test('keeps development storage in the workspace dev directory', () => {
  const appPath = path.resolve('workspace', 'TokenMonitor', 'src')
  assert.equal(
    resolveStorageDir(false, 'unused', appPath),
    path.resolve('workspace', 'TokenMonitor', '.dev-data')
  )
})
