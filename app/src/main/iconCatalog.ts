/** 图标目录：扫描游戏与模组的 .gfx 文件，收集精灵（图标）定义 */
import { readdirSync, readFileSync, existsSync, statSync } from 'fs'
import { join, extname } from 'path'
import { parseFile, findEntry, scalarText } from '../shared/clausewitz'
import type { IconSprite } from '../shared/types'

const cache = new Map<string, IconSprite[]>()

function collectSprites(gfxPath: string, root: string, onlyGoals: boolean, out: IconSprite[]): void {
  let src: string
  try {
    src = readFileSync(gfxPath, 'utf8')
  } catch {
    return
  }
  const { file } = parseFile(src, 'txt')
  if (!file) return
  for (const outer of file.items) {
    if (outer.kind !== 'entry' || outer.key?.text !== 'spriteTypes') continue
    if (!outer.value || outer.value.kind !== 'block') continue
    for (const sprite of outer.value.items) {
      if (sprite.kind !== 'entry' || !sprite.value || sprite.value.kind !== 'block') continue
      const name = scalarText(findEntry(sprite.value.items, 'name'))
      const tex = scalarText(findEntry(sprite.value.items, 'texturefile'))
      if (!name || !tex) continue
      // 游戏的 .gfx 只收录国策图标（goals 目录），避免混入立绘等大量无关精灵
      if (onlyGoals && !tex.toLowerCase().includes('goals')) continue
      const abs = join(root, tex.split('/').join('\\'))
      out.push({ name, tex, path: existsSync(abs) ? abs : null, source: gfxPath })
    }
  }
}

/** 列出可用图标：游戏 goals 图标 + 模组自定义精灵（模组同名覆盖游戏） */
export function listGoalSprites(gameDir: string | null, modPaths: string[]): IconSprite[] {
  const key = JSON.stringify([gameDir, ...modPaths])
  const hit = cache.get(key)
  if (hit) return hit

  const out: IconSprite[] = []
  if (gameDir) {
    const iface = join(gameDir, 'interface')
    let names: string[] = []
    try {
      names = readdirSync(iface)
    } catch {
      // 游戏目录不可用时跳过
    }
    for (const n of names) {
      if (extname(n).toLowerCase() === '.gfx') collectSprites(join(iface, n), gameDir, true, out)
    }
  }
  for (const modPath of modPaths) {
    const walk = (dir: string, depth: number): void => {
      if (depth > 4) return
      let names: string[] = []
      try {
        names = readdirSync(dir)
      } catch {
        return
      }
      for (const n of names) {
        const full = join(dir, n)
        try {
          if (statSync(full).isDirectory()) {
            walk(full, depth + 1)
            continue
          }
        } catch {
          continue
        }
        if (extname(n).toLowerCase() === '.gfx') collectSprites(full, modPath, false, out)
      }
    }
    walk(modPath, 0)
  }

  const byName = new Map<string, IconSprite>()
  for (const s of out) byName.set(s.name, s)
  const result = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
  cache.set(key, result)
  return result
}

const nameCache = new Map<string, string[]>()

/** 列出游戏 interface/*.gfx 里全部精灵名（不过滤 goals，供模组检查的引用校验用） */
export function listGameGfxNames(gameDir: string | null): string[] {
  if (!gameDir) return []
  const hit = nameCache.get(gameDir)
  if (hit) return hit
  const out: string[] = []
  const iface = join(gameDir, 'interface')
  let names: string[] = []
  try {
    names = readdirSync(iface)
  } catch {
    nameCache.set(gameDir, [])
    return []
  }
  const sprites: IconSprite[] = []
  for (const n of names) {
    if (extname(n).toLowerCase() === '.gfx') collectSprites(join(iface, n), gameDir, false, sprites)
  }
  for (const s of sprites) out.push(s.name)
  nameCache.set(gameDir, out)
  return out
}
