import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import type { Settings } from '../shared/types'
import { clampPaneSplit, PANE_SPLIT_DEFAULT } from '../shared/pane'

const DEFAULTS: Settings = {
  gameDir: null,
  modsDir: null,
  recentMods: [],
  paneSplit: PANE_SPLIT_DEFAULT
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function loadSettings(): Settings {
  try {
    if (!existsSync(settingsPath())) return { ...DEFAULTS }
    const raw = JSON.parse(readFileSync(settingsPath(), 'utf8'))
    return {
      gameDir: typeof raw.gameDir === 'string' ? raw.gameDir : null,
      modsDir: typeof raw.modsDir === 'string' ? raw.modsDir : null,
      recentMods: Array.isArray(raw.recentMods) ? raw.recentMods.filter((x: unknown) => typeof x === 'string') : [],
      paneSplit: clampPaneSplit(typeof raw.paneSplit === 'number' ? raw.paneSplit : Number.NaN)
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = { ...loadSettings(), ...patch }
  try {
    mkdirSync(dirname(settingsPath()), { recursive: true })
    writeFileSync(settingsPath(), JSON.stringify(next, null, 2), 'utf8')
  } catch (err) {
    console.error('保存设置失败:', err)
  }
  return next
}

/** 记录最近打开的模组（去重，最新的在前，最多 10 个） */
export function pushRecentMod(modPath: string): Settings {
  const s = loadSettings()
  s.recentMods = [modPath, ...s.recentMods.filter((p) => p !== modPath)].slice(0, 10)
  return saveSettings({ recentMods: s.recentMods })
}
