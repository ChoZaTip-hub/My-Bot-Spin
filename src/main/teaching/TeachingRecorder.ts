import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { inferRouletteMappingFromEvents } from './roulette-mapping'
import type { BrowserWindow } from 'electron'
import type { Frame, Page } from 'playwright'
import type { BrowserHost } from '../playwright/BrowserHost'
import type { Logger } from '../logger'

export type TeachingEventKind = 'click' | 'change' | 'input'

export type TeachingEvent = {
  at: number
  kind: TeachingEventKind
  tagName: string
  id?: string
  className?: string
  textSnippet?: string
  ariaLabel?: string | null
  role?: string | null
  nameAttr?: string | null
  typeAttr?: string | null
  value?: string | null
  /** Short CSS-like path for debugging / future locator hints */
  selectorHint: string
  pageX: number
  pageY: number
  clientX: number
  clientY: number
  frameUrl?: string
  rect?: { x: number; y: number; width: number; height: number }
  outerHTMLSnippet?: string
}

const SNIP = 400

/**
 * Captures user interactions on the Playwright-attached table page (embedded BrowserView or external Chromium)
 * by injecting listeners and piping payloads to the main process via Playwright {@link Page.exposeFunction}.
 */
export class TeachingRecorder {
  private recording = false
  private events: TeachingEvent[] = []
  private removeInjection: (() => Promise<void>) | null = null

  constructor(
    private readonly browserHost: BrowserHost,
    private readonly logger: Logger,
    private readonly userDataDir: string,
    private readonly getMainWindow: () => BrowserWindow | null
  ) {}

  isRecording(): boolean {
    return this.recording
  }

  getEvents(): TeachingEvent[] {
    return [...this.events]
  }

  clearBuffer(): void {
    this.events = []
  }

  async start(): Promise<{ ok: true } | { ok: false; error: string }> {
    const page = this.browserHost.getPage()
    if (!page) {
      return {
        ok: false,
        error:
          'No browser page. Open the table first (Quick start / Live with URL, or use «Open table» on the Teach tab).'
      }
    }

    if (this.recording) {
      await this.stopInternal()
    }

    this.events = []
    const bindingName = `__rsaTeaching_${Date.now()}`

    const pushAndNotify = (raw: unknown): void => {
      const ev = raw as TeachingEvent
      this.events.push(ev)
      const win = this.getMainWindow()
      win?.webContents.send('teaching:event', ev)
    }

    try {
      await page.exposeFunction(bindingName, pushAndNotify)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      this.logger.log('warn', 'Teaching exposeFunction failed', { msg })
      return { ok: false, error: msg }
    }

    const inject = makeInjectScript(bindingName)
    this.removeInjection = await injectIntoPageFrames(page, inject)

    this.recording = true
    this.logger.log('info', 'Teaching recording started', { bindingName })
    return { ok: true }
  }

  async stop(): Promise<{ ok: true } | { ok: false; error: string }> {
    const page = this.browserHost.getPage()
    if (!page) {
      this.recording = false
      this.removeInjection = null
      return { ok: true }
    }
    return this.stopInternal()
  }

  private async stopInternal(): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      if (this.removeInjection) {
        await this.removeInjection()
        this.removeInjection = null
      }
    } catch (e) {
      this.logger.log('warn', 'Teaching remove listeners failed', {
        msg: e instanceof Error ? e.message : String(e)
      })
    }

    this.recording = false
    this.logger.log('info', 'Teaching recording stopped', { events: this.events.length })
    return { ok: true }
  }

  saveSessionToDisk(filename?: string): string {
    const dir = join(this.userDataDir, 'teaching')
    mkdirSync(dir, { recursive: true })
    const name = filename ?? `session-${Date.now()}.json`
    const path = join(dir, name.replace(/[^a-zA-Z0-9._-]/g, '_'))
    const payload = {
      savedAt: Date.now(),
      events: this.events
    }
    writeFileSync(path, JSON.stringify(payload, null, 2), 'utf8')
    this.logger.log('info', 'Teaching session saved', { path })
    return path
  }

  /**
   * Writes inferred roulette mapping from the current buffer into
   * userData/teaching/mappings/<sanitizedKey>.json for the heuristic table executor.
   */
  saveInferredMappingProfile(rawKey: string): { ok: true; path: string } | { ok: false; error: string } {
    const key = rawKey.trim().replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120)
    if (!key) return { ok: false, error: 'Mapping profile key is empty' }
    if (!this.events.length) return { ok: false, error: 'No recorded events — record a session first' }
    const dir = join(this.userDataDir, 'teaching', 'mappings')
    mkdirSync(dir, { recursive: true })
    const path = join(dir, `${key}.json`)
    const mapping = inferRouletteMappingFromEvents(this.events)
    writeFileSync(path, JSON.stringify(mapping, null, 2), 'utf8')
    this.logger.log('info', 'Teaching mapping profile saved', { path })
    return { ok: true, path }
  }
}

function makeInjectScript(bindingName: string): string {
  return `(() => {
    const BN = ${JSON.stringify(bindingName)};
    if (window['__rsaTeachingCleanup']) {
      try { window['__rsaTeachingCleanup'](); } catch (_) {}
    }
    window['__rsaTeachingOn'] = true;

    function cssPath(el) {
      if (!el || el.nodeType !== 1) return '';
      if (el.id) return '#' + (window.CSS && CSS.escape ? CSS.escape(el.id) : el.id);
      const parts = [];
      let e = el;
      let depth = 0;
      while (e && e.nodeType === 1 && depth < 10) {
        let sel = e.tagName.toLowerCase();
        const cn = e.className && typeof e.className === 'string' ? e.className.trim() : '';
        if (cn) {
          const cls = cn.split(/\\s+/).filter(Boolean).slice(0, 2)
            .map(function(c) { return '.' + (window.CSS && CSS.escape ? CSS.escape(c) : c.replace(/[^a-zA-Z0-9_-]/g, '')); })
            .join('');
          if (cls) sel += cls;
        }
        const parent = e.parentElement;
        if (parent) {
          const tag = e.tagName;
          const siblings = Array.prototype.filter.call(parent.children, function(c) { return c.tagName === tag; });
          if (siblings.length > 1) {
            var idx = siblings.indexOf(e) + 1;
            sel += ':nth-of-type(' + idx + ')';
          }
        }
        parts.unshift(sel);
        e = parent;
        depth++;
      }
      return parts.join(' > ');
    }

    function basePayload(target, kind, ev) {
      const t = target && target.nodeType === 1 ? target : null;
      if (!t) return null;
      var rect = t.getBoundingClientRect ? t.getBoundingClientRect() : null;
      var html = '';
      try {
        html = t.outerHTML || '';
        if (html.length > ${SNIP}) html = html.slice(0, ${SNIP}) + '…';
      } catch (_) {}
      return {
        at: Date.now(),
        kind: kind,
        tagName: t.tagName || '',
        id: t.id || undefined,
        className: typeof t.className === 'string' ? t.className : undefined,
        textSnippet: (t.innerText || t.textContent || '').trim().slice(0, 160) || undefined,
        ariaLabel: t.getAttribute ? t.getAttribute('aria-label') : null,
        role: t.getAttribute ? t.getAttribute('role') : null,
        nameAttr: t.getAttribute ? t.getAttribute('name') : null,
        typeAttr: t.getAttribute ? t.getAttribute('type') : null,
        value: 'value' in t && t.value != null ? String(t.value).slice(0, 80) : null,
        selectorHint: cssPath(t),
        pageX: ev.pageX,
        pageY: ev.pageY,
        clientX: ev.clientX,
        clientY: ev.clientY,
        frameUrl: (function() { try { return window.location.href; } catch (_) { return ''; } })(),
        rect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : undefined,
        outerHTMLSnippet: html || undefined
      };
    }

    function send(kind, ev, target) {
      if (!window['__rsaTeachingOn']) return;
      var p = basePayload(target, kind, ev);
      if (!p) return;
      var fn = window[BN];
      if (typeof fn === 'function') fn(p);
    }

    function onClick(ev) {
      send('click', ev, ev.target);
    }
    function onChange(ev) {
      send('change', ev, ev.target);
    }
    function onInput(ev) {
      send('input', ev, ev.target);
    }

    document.addEventListener('click', onClick, true);
    document.addEventListener('change', onChange, true);
    document.addEventListener('input', onInput, true);

    window['__rsaTeachingCleanup'] = function() {
      window['__rsaTeachingOn'] = false;
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('change', onChange, true);
      document.removeEventListener('input', onInput, true);
    };
  })();`
}

async function injectIntoPageFrames(
  page: Page,
  scriptSource: string
): Promise<() => Promise<void>> {
  const frames: Frame[] = [...page.frames()]
  const cleanups: (() => Promise<void>)[] = []

  for (const frame of frames) {
    try {
      await frame.evaluate(scriptSource)
      cleanups.push(async () => {
        try {
          await frame.evaluate(`(() => {
            if (window['__rsaTeachingCleanup']) window['__rsaTeachingCleanup']();
          })();`)
        } catch {
          /* frame may be detached */
        }
      })
    } catch {
      /* cross-origin or detached */
    }
  }

  return async () => {
    for (const c of cleanups) {
      await c()
    }
  }
}
