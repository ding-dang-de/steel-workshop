import { homedir } from 'os'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { Hoi4Info } from '../shared/types'

/** 从 Steam 的 libraryfolders.vdf 收集所有游戏库路径 */
function steamLibraries(): string[] {
  const libs: string[] = []
  for (const vdfPath of [
    join('C:', 'Program Files (x86)', 'Steam', 'steamapps', 'libraryfolders.vdf'),
    join('C:', 'Program Files', 'Steam', 'steamapps', 'libraryfolders.vdf')
  ]) {
    try {
      if (!existsSync(vdfPath)) continue
      const text = readFileSync(vdfPath, 'utf8')
      for (const m of text.matchAll(/"path"\s+"((?:[^"\\]|\\.)*)"/g)) {
        const p = m[1].replace(/\\\\/g, '\\')
        if (p && !libs.includes(p)) libs.push(p)
      }
    } catch {
      // 忽略
    }
  }
  return libs
}

/** 自动检测游戏目录、模组目录和游戏版本 */
export function detectHoi4(): Hoi4Info {
  // 模组目录
  let modsDir: string | null = null
  for (const candidate of [
    join(homedir(), 'Documents', 'Paradox Interactive', 'Hearts of Iron IV', 'mod'),
    join(homedir(), 'OneDrive', 'Documents', 'Paradox Interactive', 'Hearts of Iron IV', 'mod')
  ]) {
    if (existsSync(candidate)) {
      modsDir = candidate
      break
    }
  }

  // 游戏目录
  let gameDir: string | null = null
  const candidates = [
    join('C:', 'Program Files (x86)', 'Steam', 'steamapps', 'common', 'Hearts of Iron IV'),
    join('C:', 'Program Files', 'Steam', 'steamapps', 'common', 'Hearts of Iron IV'),
    ...steamLibraries().map((lib) => join(lib, 'steamapps', 'common', 'Hearts of Iron IV'))
  ]
  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'hoi4.exe'))) {
      gameDir = candidate
      break
    }
  }

  // 游戏版本（游戏目录里的 launcher-settings.json）
  let version: string | null = null
  if (gameDir) {
    try {
      const raw = JSON.parse(readFileSync(join(gameDir, 'launcher-settings.json'), 'utf8'))
      if (typeof raw.rawVersion === 'string') version = raw.rawVersion
    } catch {
      // 忽略
    }
  }

  return { gameDir, modsDir, version }
}
