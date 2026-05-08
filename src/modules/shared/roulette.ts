/** European roulette wheel numbers 0–36 */
export const EUROPEAN_POCKETS = 37

export const RED_NUMBERS = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36
])

export function isRed(n: number): boolean {
  if (n === 0) return false
  return RED_NUMBERS.has(n)
}

export function isBlack(n: number): boolean {
  if (n === 0) return false
  return !RED_NUMBERS.has(n)
}

export function dozenOf(n: number): 1 | 2 | 3 | null {
  if (n === 0) return null
  if (n >= 1 && n <= 12) return 1
  if (n >= 13 && n <= 24) return 2
  if (n >= 25 && n <= 36) return 3
  return null
}

export function columnOf(n: number): 1 | 2 | 3 | null {
  if (n === 0) return null
  const m = ((n - 1) % 3) + 1
  return m as 1 | 2 | 3
}

export function isEven(n: number): boolean {
  if (n === 0) return false
  return n % 2 === 0
}

export function isLow(n: number): boolean {
  return n >= 1 && n <= 18
}

export function isHigh(n: number): boolean {
  return n >= 19 && n <= 36
}

/** Payout multiplier on stake for a winning bet (European). */
export function payoutMultiplier(betType: string): number {
  switch (betType) {
    case 'red':
    case 'black':
    case 'even':
    case 'odd':
    case 'low':
    case 'high':
      return 1
    case 'dozen':
    case 'column':
      return 2
    case 'straight':
      return 35
    case 'group':
      return 1
    default:
      return 1
  }
}
