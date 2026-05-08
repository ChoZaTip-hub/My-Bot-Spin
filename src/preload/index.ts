import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '@modules/shared/ipc-channels'

const api = {
  settings: {
    get: () => ipcRenderer.invoke(IPC_CHANNELS.settingsGet),
    set: (partial: unknown) => ipcRenderer.invoke(IPC_CHANNELS.settingsSet, partial)
  },
  strategies: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.strategiesList),
    get: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.strategyGet, id),
    save: (cfg: unknown) => ipcRenderer.invoke(IPC_CHANNELS.strategySave, cfg),
    delete: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.strategyDelete, id),
    validate: (cfg: unknown) => ipcRenderer.invoke(IPC_CHANNELS.strategyValidate, cfg)
  },
  simulation: {
    run: (req: unknown) => ipcRenderer.invoke(IPC_CHANNELS.simulationRun, req),
    runHistorical: (req: unknown) => ipcRenderer.invoke(IPC_CHANNELS.simulationRunHistorical, req),
    get: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.simulationGet, id),
    exportCsv: (rows: { bankroll: number }[]) =>
      ipcRenderer.invoke(IPC_CHANNELS.exportResultsCsv, rows)
  },
  session: {
    start: (req: unknown) => ipcRenderer.invoke(IPC_CHANNELS.sessionStart, req),
    stop: () => ipcRenderer.invoke(IPC_CHANNELS.sessionStop),
    pause: () => ipcRenderer.invoke(IPC_CHANNELS.sessionPause),
    resume: () => ipcRenderer.invoke(IPC_CHANNELS.sessionResume),
    timeline: () => ipcRenderer.invoke(IPC_CHANNELS.sessionTimeline),
    status: () => ipcRenderer.invoke(IPC_CHANNELS.sessionStatus),
    confirm: (payload: unknown) => ipcRenderer.invoke(IPC_CHANNELS.sessionConfirm, payload)
  },
  browser: {
    launch: (url?: string) => ipcRenderer.invoke(IPC_CHANNELS.browserLaunch, url),
    close: () => ipcRenderer.invoke(IPC_CHANNELS.browserClose)
  },
  import: {
    spinsCsv: (filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.importSpinsCsv, filePath)
  },
  dialog: {
    pickCsv: () => ipcRenderer.invoke(IPC_CHANNELS.dialogPickFile)
  },
  logs: {
    query: (filter: { level?: string; limit?: number }) =>
      ipcRenderer.invoke(IPC_CHANNELS.logsQuery, filter)
  },
  analytics: {
    overview: () => ipcRenderer.invoke(IPC_CHANNELS.analyticsOverview)
  },
  onTimeline: (cb: (e: unknown) => void) => {
    const listener = (_: Electron.IpcRendererEvent, data: unknown) => cb(data)
    ipcRenderer.on('session:timeline-event', listener)
    return () => ipcRenderer.removeListener('session:timeline-event', listener)
  },
  onLogLine: (cb: (e: unknown) => void) => {
    const listener = (_: Electron.IpcRendererEvent, data: unknown) => cb(data)
    ipcRenderer.on('log:line', listener)
    return () => ipcRenderer.removeListener('log:line', listener)
  }
}

contextBridge.exposeInMainWorld('rsa', api)

export type RsaApi = typeof api
