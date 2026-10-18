import { ipcMain, dialog, BrowserWindow } from 'electron'
import { readFileSync, existsSync, statSync } from 'fs'
import { loadSettings, saveSettings, pushRecentMod } from './settings'
import { detectHoi4 } from './hoi4'
import { createMod, openModInfo, readModDescriptor, writeTextFile, listDir } from './modManager'
import { listGoalSprites, listGameGfxNames } from './iconCatalog'
import type { Settings, Hoi4Info } from '../shared/types'

const MAX_READ_BYTES = 5 * 1024 * 1024 // 5MB 上限，防止误开巨型文件
const MAX_BINARY_BYTES = 20 * 1024 * 1024 // 贴图读取上限 20MB

export function registerIpc(): void {
  // ---- 对话框 ----
  ipcMain.handle('dialog:selectFolder', async (_e, defaultPath?: string) => {
    const win = BrowserWindow.getFocusedWindow() ?? undefined
    const result = await dialog.showOpenDialog(win!, {
      title: '选择文件夹',
      defaultPath: defaultPath || undefined,
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  // ---- 文件读写 ----
  ipcMain.handle('fs:readText', (_e, filePath: string) => {
    if (typeof filePath !== 'string' || !existsSync(filePath)) throw new Error('文件不存在')
    const stat = statSync(filePath)
    if (stat.size > MAX_READ_BYTES) {
      throw new Error(`文件过大（${Math.round(stat.size / 1024)}KB），本工具暂只支持 5MB 以内的文本文件`)
    }
    return readFileSync(filePath, 'utf8')
  })

  ipcMain.handle('fs:writeText', (_e, filePath: string, content: string) => {
    if (typeof filePath !== 'string' || typeof content !== 'string') throw new Error('参数错误')
    return writeTextFile(filePath, content)
  })

  ipcMain.handle('fs:listDir', (_e, dirPath: string) => listDir(dirPath))

  ipcMain.handle('fs:readBytes', (_e, filePath: string): ArrayBuffer => {
    if (typeof filePath !== 'string' || !existsSync(filePath)) throw new Error('文件不存在')
    const stat = statSync(filePath)
    if (stat.size > MAX_BINARY_BYTES) {
      throw new Error(`文件过大（${Math.round(stat.size / 1024)}KB），超过 20MB 上限`)
    }
    const buf = readFileSync(filePath)
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  })

  // ---- 模组管理 ----
  ipcMain.handle('mod:open', (_e, modPath: string) => {
    if (typeof modPath !== 'string' || !existsSync(modPath)) throw new Error('模组文件夹不存在')
    pushRecentMod(modPath)
    return openModInfo(modPath)
  })

  ipcMain.handle('mod:create', (_e, name: string, modsDir: string) => {
    const hoi4 = detectHoi4()
    const version = hoi4.version ?? '1.15'
    const result = createMod(name, modsDir, version)
    pushRecentMod(result.modPath)
    return result
  })

  ipcMain.handle('mod:descriptor', (_e, modPath: string) => {
    if (typeof modPath !== 'string') return null
    return readModDescriptor(modPath)
  })

  // ---- 图标目录 ----
  ipcMain.handle('icons:list', (_e, gameDir: string | null, modPaths: string[]) => {
    if ((typeof gameDir !== 'string' && gameDir !== null) || !Array.isArray(modPaths)) {
      throw new Error('参数错误')
    }
    return listGoalSprites(gameDir, modPaths)
  })
  ipcMain.handle('gfx:listGameNames', (_e, gameDir: string | null) => {
    if (typeof gameDir !== 'string' && gameDir !== null) throw new Error('参数错误')
    return listGameGfxNames(gameDir)
  })

  // ---- 设置与检测 ----
  ipcMain.handle('settings:get', () => loadSettings())
  ipcMain.handle('settings:set', (_e, patch: Partial<Settings>) => saveSettings(patch))
  ipcMain.handle('hoi4:detect', (): Hoi4Info => detectHoi4())
}
