import { describe, expect, it } from 'vitest'
import { SessionConfirmPayloadSchema } from '@modules/shared/ipc-contract'

describe('IPC contract validation', () => {
  it('parses session confirm payload', () => {
    const p = SessionConfirmPayloadSchema.parse({
      sessionId: 'abc',
      accept: true
    })
    expect(p.sessionId).toBe('abc')
    expect(p.accept).toBe(true)
  })
})
