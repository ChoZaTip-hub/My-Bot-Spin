import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/**
 * Opens a URL in the system Safari.app (macOS only).
 * Safari does not expose Chrome DevTools Protocol — automation uses Playwright WebKit separately.
 */
export async function openUrlInSafariApp(url: string): Promise<void> {
  if (process.platform !== 'darwin') {
    throw new Error('Safari.app is only available on macOS')
  }
  if (!url.startsWith('http')) {
    throw new Error('Invalid URL for Safari')
  }
  await execFileAsync('open', ['-a', 'Safari', url])
}
