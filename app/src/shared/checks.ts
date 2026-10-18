/**
 * 模组跨文件检查引擎（第四期「更多检查项」）
 *
 * 只读扫描：输入模组全部相关文件内容 + 游戏 GFX 名集合，输出问题列表。
 * 检查项：
 * - loc-missing    本地化键缺失（国策/事件/决议/精神/特质/人物的显式键）
 * - gfx-undefined  引用了未定义的 GFX 精灵名（对照游戏 + 模组 .gfx）
 * - gfx-duplicate  同名精灵在多个模组 .gfx 文件中定义（后加载覆盖先加载）
 * - event-missing  国策完成效果触发的事件 id 在模组事件文件中不存在
 */

import { loadLoc } from './localisation.ts'
import { extractFocusIds } from './localisation.ts'
import { loadFocusTree, getFocusFiredEvents } from './focusTree.ts'
import { loadEvents } from './events.ts'
import { loadDecisions } from './decisions.ts'
import { loadIdeas } from './ideas.ts'
import { loadTraits } from './traits.ts'
import { loadCharacters } from './characters.ts'
import { extractGfxSpriteNames } from './gfx.ts'

export type CheckKind = 'loc-missing' | 'gfx-undefined' | 'gfx-duplicate' | 'event-missing'

export interface CheckIssue {
  kind: CheckKind
  /** 出问题的文件（模组内相对路径） */
  file: string
  /** 问题主体（本地化键 / GFX 名 / 事件 id），跳转定位用 */
  subject: string
  message: string
}

export interface ModCheckInput {
  files: { rel: string; source: string }[]
  /** 游戏定义的 GFX 精灵名（引用校验用；缺省只对照模组内定义） */
  gameGfxNames?: Set<string>
}

export const CHECK_KIND_LABELS: Record<CheckKind, string> = {
  'loc-missing': '缺失本地化键',
  'gfx-undefined': 'GFX 未定义',
  'gfx-duplicate': 'GFX 重复定义',
  'event-missing': '事件不存在'
}

/** 目录归属判断（与 ModView 的路径规则一致） */
const isLocFile = (rel: string): boolean => rel.startsWith('localisation/')
const isFocusFile = (rel: string): boolean => rel.startsWith('common/national_focus/')
const isEventFile = (rel: string): boolean => rel.startsWith('events/')
const isDecisionFile = (rel: string): boolean =>
  rel.startsWith('common/decisions/') && !rel.startsWith('common/decisions/categories/')
const isIdeaFile = (rel: string): boolean => rel.startsWith('common/ideas/')
const isTraitFile = (rel: string): boolean => rel.startsWith('common/country_leader/')
const isCharacterFile = (rel: string): boolean => rel.startsWith('common/characters/')
const isGfxFile = (rel: string): boolean => rel.split('.').pop()?.toLowerCase() === 'gfx'

/** 去引号（模型字段有的带引号有的不带，统一成裸值） */
function stripQuotes(text: string): string {
  const t = text.trim()
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1)
  return t
}

/** GFX 引用只查 GFX_ 前缀的（generic_xxx 等名字是游戏硬编码，不在 .gfx 里） */
function isGfxRef(value: string): boolean {
  return value.startsWith('GFX_')
}

export function runModChecks(input: ModCheckInput): CheckIssue[] {
  const issues: CheckIssue[] = []
  const { files, gameGfxNames } = input

  // 全部本地化键（合并所有 loc 文件）
  const locKeys = new Set<string>()
  for (const f of files) {
    if (!isLocFile(f.rel)) continue
    const loc = loadLoc(f.source)
    if (loc) for (const k of loc.byKey.keys()) locKeys.add(k)
  }

  // 模组全部 GFX 名（含跨文件重复检测）
  const gfxNamesByFile = new Map<string, string[]>()
  for (const f of files) {
    if (!isGfxFile(f.rel)) continue
    gfxNamesByFile.set(f.rel, extractGfxSpriteNames(f.source))
  }
  const modGfxNames = new Set<string>()
  for (const names of gfxNamesByFile.values()) for (const n of names) modGfxNames.add(n)
  const allGfxNames = new Set(modGfxNames)
  if (gameGfxNames) for (const n of gameGfxNames) allGfxNames.add(n)

  // 全部事件 id
  const eventIds = new Set<string>()

  const pushLocMissing = (file: string, key: string, what: string): void => {
    issues.push({ kind: 'loc-missing', file, subject: key, message: `${what}「${key}」在本地化文件中没有对应条目` })
  }
  const pushGfxUndefined = (file: string, gfx: string, what: string): void => {
    issues.push({ kind: 'gfx-undefined', file, subject: gfx, message: `${what}引用的精灵「${gfx}」在游戏和模组的 .gfx 里都没有定义` })
  }

  for (const f of files) {
    // ---- 事件：收集 id + 标题/描述/图片 ----
    if (isEventFile(f.rel)) {
      const model = loadEvents(f.source)
      if (model) {
        for (const ev of model.events) {
          eventIds.add(ev.id)
          if (ev.title && !locKeys.has(stripQuotes(ev.title))) pushLocMissing(f.rel, stripQuotes(ev.title), '事件标题')
          if (ev.desc && !locKeys.has(stripQuotes(ev.desc))) pushLocMissing(f.rel, stripQuotes(ev.desc), '事件描述')
          if (ev.picture && isGfxRef(stripQuotes(ev.picture)) && !allGfxNames.has(stripQuotes(ev.picture))) {
            pushGfxUndefined(f.rel, stripQuotes(ev.picture), '事件图片')
          }
        }
      }
      continue
    }

    // ---- 决议：本地化 + 图标 ----
    if (isDecisionFile(f.rel)) {
      const model = loadDecisions(f.source)
      if (model) {
        for (const d of model.decisions) {
          if (!locKeys.has(d.id)) pushLocMissing(f.rel, d.id, '决议名称')
          if (!locKeys.has(`${d.id}_desc`)) pushLocMissing(f.rel, `${d.id}_desc`, '决议描述')
          if (d.icon && isGfxRef(stripQuotes(d.icon)) && !allGfxNames.has(stripQuotes(d.icon))) {
            pushGfxUndefined(f.rel, stripQuotes(d.icon), '决议图标')
          }
        }
      }
      continue
    }

    // ---- 民族精神：本地化 + 图片 ----
    if (isIdeaFile(f.rel)) {
      const model = loadIdeas(f.source)
      if (model) {
        for (const idea of model.ideas) {
          if (!locKeys.has(idea.id)) pushLocMissing(f.rel, idea.id, '精神名称')
          if (!locKeys.has(`${idea.id}_desc`)) pushLocMissing(f.rel, `${idea.id}_desc`, '精神描述')
          if (idea.picture && isGfxRef(stripQuotes(idea.picture)) && !allGfxNames.has(stripQuotes(idea.picture))) {
            pushGfxUndefined(f.rel, stripQuotes(idea.picture), '精神图片')
          }
        }
      }
      continue
    }

    // ---- 领导人特质：本地化 ----
    if (isTraitFile(f.rel)) {
      const model = loadTraits(f.source)
      if (model) {
        for (const t of model.traits) {
          if (!locKeys.has(t.id)) pushLocMissing(f.rel, t.id, '特质名称')
          if (!locKeys.has(`${t.id}_desc`)) pushLocMissing(f.rel, `${t.id}_desc`, '特质描述')
        }
      }
      continue
    }

    // ---- 人物：名字键 + 肖像 GFX ----
    if (isCharacterFile(f.rel)) {
      const model = loadCharacters(f.source)
      if (model) {
        for (const ch of model.characters) {
          const name = stripQuotes(ch.name)
          if (name && !locKeys.has(name)) pushLocMissing(f.rel, name, '人物名字')
          for (const g of ch.portraits) {
            for (const [size, sprite] of [['small', g.small], ['large', g.large]] as const) {
              if (!sprite) continue
              const s = stripQuotes(sprite)
              if (isGfxRef(s) && !allGfxNames.has(s)) {
                issues.push({
                  kind: 'gfx-undefined',
                  file: f.rel,
                  subject: s,
                  message: `人物「${stripQuotes(ch.name) || ch.id}」的 ${g.scope}.${size} 肖像引用的精灵「${s}」在游戏和模组的 .gfx 里都没有定义`
                })
              }
            }
          }
        }
      }
      continue
    }
  }

  // ---- 国策：本地化 + 触发事件（放在事件收集之后，避免把存在的事件误报为缺失） ----
  for (const f of files) {
    if (!isFocusFile(f.rel)) continue
    const tree = loadFocusTree(f.source)
    if (!tree) continue
    for (const id of extractFocusIds(f.source)) {
      if (!locKeys.has(id)) pushLocMissing(f.rel, id, '国策名称')
      if (!locKeys.has(`${id}_desc`)) pushLocMissing(f.rel, `${id}_desc`, '国策描述')
    }
    for (const node of tree.nodes) {
      if (node.icon && isGfxRef(stripQuotes(node.icon)) && !allGfxNames.has(stripQuotes(node.icon))) {
        pushGfxUndefined(f.rel, stripQuotes(node.icon), '国策图标')
      }
      for (const ref of getFocusFiredEvents(node.entry)) {
        if (!eventIds.has(ref.id)) {
          issues.push({
            kind: 'event-missing',
            file: f.rel,
            subject: ref.id,
            message: `国策「${node.id}」完成效果触发的事件「${ref.id}」在模组事件文件中不存在（也可能是游戏原版事件）`
          })
        }
      }
    }
  }

  // ---- GFX 跨文件重复定义 ----
  {
    const nameToFiles = new Map<string, string[]>()
    for (const [rel, names] of gfxNamesByFile) {
      const seen = new Set<string>()
      for (const n of names) {
        if (seen.has(n)) continue
        seen.add(n)
        const arr = nameToFiles.get(n) ?? []
        arr.push(rel)
        nameToFiles.set(n, arr)
      }
    }
    for (const [name, rels] of [...nameToFiles.entries()].sort()) {
      if (rels.length < 2) continue
      issues.push({
        kind: 'gfx-duplicate',
        file: rels[1],
        subject: name,
        message: `精灵「${name}」在 ${rels.length} 个文件里重复定义（后加载的覆盖先加载的）：${rels.join('、')}`
      })
    }
  }

  const kindOrder: CheckKind[] = ['loc-missing', 'gfx-undefined', 'gfx-duplicate', 'event-missing']
  issues.sort((a, b) => {
    const ka = kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind)
    if (ka !== 0) return ka
    return a.file.localeCompare(b.file) || a.subject.localeCompare(b.subject)
  })
  return issues
}
