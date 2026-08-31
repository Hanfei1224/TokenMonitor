import assert from 'node:assert/strict'
import test from 'node:test'
import { parseCodexUsage } from './codexUsage.ts'

test('parses Codex plan and actual usage windows', () => {
  const result = parseCodexUsage({
    plan_type: 'plus',
    rate_limit: {
      primary_window: {
        used_percent: 25,
        limit_window_seconds: 18_000,
        reset_at: 1_800_000_000
      },
      secondary_window: {
        used_percent: 60,
        limit_window_seconds: 604_800,
        reset_after_seconds: 86_400
      }
    }
  }, 'user@example.com')

  assert.equal(result.planType, 'plus')
  assert.equal(result.email, 'user@example.com')
  assert.deepEqual(result.windows?.map(({ id, label, percent, windowDurationMins }) => ({
    id,
    label,
    percent,
    windowDurationMins
  })), [
    { id: 'primary', label: '5H余额', percent: 75, windowDurationMins: 300 },
    { id: 'secondary', label: '本周余额', percent: 40, windowDurationMins: 10_080 }
  ])
  assert.equal(result.windows?.[0].resetsAt, new Date(1_800_000_000 * 1000).toISOString())
})

test('rejects an unrecognized usage response', () => {
  assert.equal(parseCodexUsage({ error: 'temporarily unavailable' }).error, 'Codex 额度返回格式异常')
  assert.equal(parseCodexUsage({ plan_type: 'plus', rate_limit: {} }).error, 'Codex 额度返回格式异常')
})
