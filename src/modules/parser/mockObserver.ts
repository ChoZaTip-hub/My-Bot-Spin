import type { TableObservation, TableObserver } from './types'

export class MockTableObserver implements TableObserver {
  readonly id = 'mock'

  constructor(private readonly seq: () => TableObservation) {}

  async observe(): Promise<TableObservation> {
    return this.seq()
  }
}

export function staticObservation(obs: TableObservation): TableObserver {
  return new MockTableObserver(() => obs)
}
