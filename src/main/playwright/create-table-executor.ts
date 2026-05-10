import type { Page } from 'playwright'
import type { TableExecutor } from '@modules/executor/types'
import { MockTableExecutor } from '@modules/executor/mockExecutor'
import { loadRouletteMapping } from '../teaching/load-mapping'
import { HeuristicRouletteExecutor } from './HeuristicRouletteExecutor'

/**
 * Builds the live table executor for any URL with an attached Playwright page.
 * Uses optional recorded mapping files under userData/teaching/mappings (see {@link loadRouletteMapping}).
 */
export function createTableExecutor(
  page: Page | null,
  startUrl: string | undefined,
  userDataDir: string,
  teachingMappingKey?: string | null
): TableExecutor {
  if (!page || !startUrl?.trim().startsWith('http')) {
    return new MockTableExecutor()
  }
  const mapping = loadRouletteMapping(userDataDir, teachingMappingKey, startUrl.trim())
  return new HeuristicRouletteExecutor(page, mapping)
}
