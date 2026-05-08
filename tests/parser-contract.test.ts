import { describe, expect, it } from 'vitest'
import { staticObservation } from '@modules/parser/mockObserver'

describe('parser adapter contract', () => {
  it('mock observer returns stable shape', async () => {
    const obs = staticObservation({
      recentNumbers: [5, 12, 0],
      bettingOpen: true,
      timerSeconds: 12,
      balance: 250,
      tableLabel: 'unit',
      rawNote: 'test'
    })
    const s = await obs.observe()
    expect(s.recentNumbers).toEqual([5, 12, 0])
    expect(s.bettingOpen).toBe(true)
    expect(s.timerSeconds).toBe(12)
    expect(s.balance).toBe(250)
    expect(s.tableLabel).toBe('unit')
  })
})
