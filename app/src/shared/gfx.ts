/**
 * .gfx 精灵文件模型 —— 图标库管理（第四期）
 *
 * .gfx 文件顶层是 spriteTypes = { ... } 块，块内每个条目定义一个精灵
 * （条目键名通常为 spriteType / SpriteType，值块含 name 与 texturefile 等）。
 * 本模块只读：解析出精灵列表供查看器展示（名字、贴图路径、其它标量字段），
 * 并检测重复精灵名（游戏只会采用最后一个定义，重复是常见错误）。
 * 文件本身保持无损，不做修改。
 */

import { parseFile, findEntry, scalarText } from './clausewitz.ts'
import type { CwFile } from './clausewitz.ts'

export interface GfxSprite {
  /** 精灵名，如 GFX_portrait_FRA_marcel_cachin_large */
  name: string
  /** 贴图相对路径，如 gfx/leaders/FRA/portrait_FRA_marcel_cachin.dds */
  tex: string
  /** 其它标量字段（如 noOfFrames / animation / effectFile），留给详情展示 */
  extra: [string, string][]
}

export interface GfxModel {
  file: CwFile
  sprites: GfxSprite[]
  /** 重复定义的名字 → 出现次数（仅含 ≥2 次的名字） */
  duplicates: Map<string, number>
  errors: { message: string; line: number; col: number }[]
}

/** 大小写不敏感地查块内条目（.gfx 里 spriteType / SpriteType 两种写法都存在） */
function findEntryCI(items: CwFile['items'], key: string): ReturnType<typeof findEntry> {
  const k = key.toLowerCase()
  return (
    items.find((x) => !x.deleted && x.key && x.key.text.toLowerCase() === k) ??
    null
  )
}

/** 每次调用都重新读取（保持最新状态） */
export function buildGfx(file: CwFile): { sprites: GfxSprite[]; duplicates: Map<string, number> } {
  const sprites: GfxSprite[] = []
  for (const outer of file.items) {
    if (outer.deleted || !outer.key || outer.key.text.toLowerCase() !== 'spritetypes') continue
    if (!outer.value || outer.value.kind !== 'block') continue
    for (const sprite of outer.value.items) {
      if (sprite.deleted || !sprite.key || sprite.key.text.toLowerCase() !== 'spritetype') continue
      if (!sprite.value || sprite.value.kind !== 'block') continue
      const name = scalarText(findEntryCI(sprite.value.items, 'name'))
      const tex = scalarText(findEntryCI(sprite.value.items, 'texturefile'))
      if (!name || !tex) continue
      const extra: [string, string][] = []
      for (const it of sprite.value.items) {
        if (it.deleted || !it.key || it.value?.kind !== 'scalar') continue
        const k = it.key.text
        if (k.toLowerCase() === 'name' || k.toLowerCase() === 'texturefile') continue
        extra.push([k, it.value.token.text])
      }
      sprites.push({ name, tex, extra })
    }
  }
  const duplicates = new Map<string, number>()
  for (const s of sprites) duplicates.set(s.name, (duplicates.get(s.name) ?? 0) + 1)
  for (const [k, v] of duplicates) if (v < 2) duplicates.delete(k)
  return { sprites, duplicates }
}

/** 解析 .gfx 文件；没有 spriteTypes 块时也返回模型（空列表） */
export function loadGfx(source: string): GfxModel | null {
  const { file, errors } = parseFile(source, 'txt')
  if (!file) return null
  const { sprites, duplicates } = buildGfx(file)
  return { file, sprites, duplicates, errors }
}

/** 提取文件里全部精灵名（模组检查用） */
export function extractGfxSpriteNames(source: string): string[] {
  const { file } = parseFile(source, 'txt')
  if (!file) return []
  return buildGfx(file).sprites.map((s) => s.name)
}
