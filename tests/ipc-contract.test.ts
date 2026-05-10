import { describe, expect, it } from 'vitest'
import { SessionConfirmPayloadSchema, SessionStartRequestSchema } from '@modules/shared/ipc-contract'

describe('IPC contract validation', () => {
  it('parses session confirm payload', () => {
    const p = SessionConfirmPayloadSchema.parse({
      sessionId: 'abc',
      accept: true
    })
    expect(p.sessionId).toBe('abc')
    expect(p.accept).toBe(true)
  })

  it('allows observer session start without strategy', () => {
    const r = SessionStartRequestSchema.parse({
      mode: 'observer',
      initialBankroll: 100,
      startUrl: 'https://example.com/table'
    })
    expect(r.mode).toBe('observer')
    expect(r.strategyId).toBeUndefined()
  })
})
