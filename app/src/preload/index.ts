import { contextBridge, ipcRenderer } from 'electron'
import type {
  Settings,
  Hoi4Info,
  OpenModInfo,
  CreateModResult,
  ModDescriptor,
  IconSprite
} from '../shared/types'

const api = {
  appName: '钢铁工坊',
  versions: {
    electron: process.versions.electron ?? '',
    chrome: process.versions.chrome ?? '',
    node: process.versions.node ?? ''
  },

  // 对话框
  selectFolder: (defaultPath?: string): Promise<string | null> =>
    ipcRenderer.invoke('dialog:selectFolder', defaultPath),

  // 文件读写
  readTextFile: (path: string): Promise<string> => ipcRenderer.invoke('fs:readText', path),
  writeTextFile: (path: string, content: string): Promise<{ backedUp: string | null }> =>
    ipcRenderer.invoke('fs:writeText', path, content),
  listDir: (path: string): Promise<{ name: string; path: string; isDir: boolean }[]> =>
    ipcRenderer.invoke('fs:listDir', path),
  readBytes: (path: string): Promise<ArrayBuffer> => ipcRenderer.invoke('fs:readBytes', path),
  listGoalSprites: (gameDir: string | null, modPaths: string[]): Promise<IconSprite[]> =>
    ipcRenderer.invoke('icons:list', gameDir, modPaths),
  listGameGfxNames: (gameDir: string | null): Promise<string[]> =>
    ipcRenderer.invoke('gfx:listGameNames', gameDir),

  // 模组管理
  openMod: (modPath: string): Promise<OpenModInfo> => ipcRenderer.invoke('mod:open', modPath),
  createMod: (name: string, modsDir: string): Promise<CreateModResult> =>
    ipcRenderer.invoke('mod:create', name, modsDir),
  readModDescriptor: (modPath: string): Promise<ModDescriptor | null> =>
    ipcRenderer.invoke('mod:descriptor', modPath),

  // 设置与检测
  getSettings: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
  setSettings: (patch: Partial<Settings>): Promise<Settings> =>
    ipcRenderer.invoke('settings:set', patch),
  detectHoi4: (): Promise<Hoi4Info> => ipcRenderer.invoke('hoi4:detect')
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
