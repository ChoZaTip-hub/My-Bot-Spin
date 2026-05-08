/** Read-only snapshot of visible table state (site-agnostic shape). */
export type TableObservation = {
  recentNumbers: number[]
  bettingOpen: boolean | null
  timerSeconds: number | null
  balance: number | null
  tableLabel: string | null
  /** When the UI exposes a round / ticket id, use it to detect a new spin even if the winning number repeats. */
  roundId?: string | null
  rawNote?: string
}

export interface TableObserver {
  readonly id: string
  observe(): Promise<TableObservation>
}
