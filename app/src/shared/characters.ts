/**
 * 人物（characters）文件数据模型 —— 在无损解析器之上提供读取与修改
 *
 * characters 文件顶层是 characters = { ... } 块，块内每个条目就是一个角色
 * （条目键名 = 角色 id，如 FRA_Marcel_Cachin = { ... }）。
 * 角色块字段：name（本地化键）、portraits（civilian/army/navy 组 × small/large）、
 * 以及一个职位块：country_leader（ideology/traits/expire）、field_marshal（技能）、
 * advisor（slot/idea_token/allowed/available/traits/ai_will_do）等。
 * traits 列表是块内裸值列表（traits = { A B }，单行或每行一个）。
 * 所有修改只标记相关条目 dirty；结构化编辑（allowed/available/ai_will_do）整块重写，
 * 其余字节原样保留。
 */

import { parseFile, serialize, findEntry, findDeletedEntry, makeScalarEntry, makeBlockEntry, makeBareItem, newlineOfBlock } from './clausewitz.ts'
import type { CwFile, CwItem } from './clausewitz.ts'
import { getCondBlockOf, setCondBlockOf } from './conditions.ts'
import type { CondNode } from './conditions.ts'

/** 职位块键名（按文件里出现的顺序识别） */
export const ROLE_KEYS = ['country_leader', 'field_marshal', 'corps_commander', 'advisor', 'unit_leader'] as const
export type RoleKey = (typeof ROLE_KEYS)[number]

export interface PortraitGroup {
  scope: string
  small: string | null
  large: string | null
}

export interface CharacterDef {
  /** 底层条目（角色块，如 FRA_Marcel_Cachin = { ... }） */
  entry: CwItem
  /** 角色 id（条目键名；本地化键 = name 字段，通常等于 id） */
  id: string
  /** name 字段的值（本地化键；缺失为 ''） */
  name: string
  role: RoleKey | 'none'
  /** 职位块条目（country_leader = { ... } 等；无职位为 null） */
  roleEntry: CwItem | null
  /** 已有肖像组：[{scope, small, large}]，按文件顺序（空组也列出） */
  portraits: PortraitGroup[]
}

export interface CharactersModel {
  file: CwFile
  characters: CharacterDef[]
  errors: { message: string; line: number; col: number }[]
}

/** 每次调用都重新读取，保证拿到最新状态 */
export function buildCharacters(file: CwFile): CharacterDef[] {
  const characters: CharacterDef[] = []
  const top = findEntry(file.items, 'characters')
  if (top && top.value?.kind === 'block') {
    for (const it of top.value.items) {
      if (it.deleted || !it.key || it.value?.kind !== 'block') continue
      const items = it.value.items
      const nameEntry = findEntry(items, 'name')
      let role: RoleKey | 'none' = 'none'
      let roleEntry: CwItem | null = null
      for (const rk of ROLE_KEYS) {
        const re = findEntry(items, rk)
        if (re) {
          role = rk
          roleEntry = re
          break
        }
      }
      const portraits: PortraitGroup[] = []
      const pb = findEntry(items, 'portraits')
      if (pb && pb.value?.kind === 'block') {
        for (const scope of pb.value.items) {
          if (scope.deleted || !scope.key || scope.value?.kind !== 'block') continue
          const small = findEntry(scope.value.items, 'small')
          const large = findEntry(scope.value.items, 'large')
          portraits.push({
            scope: scope.key.text,
            small: small && small.value?.kind === 'scalar' ? small.value.token.text : null,
            large: large && large.value?.kind === 'scalar' ? large.value.token.text : null
          })
        }
      }
      characters.push({
        entry: it,
        id: it.key.text,
        name: nameEntry && nameEntry.value?.kind === 'scalar' ? nameEntry.value.token.text : '',
        role,
        roleEntry,
        portraits
      })
    }
  }
  return characters
}

/** 解析人物文件；没有角色条目时也返回模型（用于新建文件后的空态） */
export function loadCharacters(source: string): CharactersModel | null {
  const { file, errors } = parseFile(source, 'txt')
  if (!file) return null
  const characters = buildCharacters(file)
  return { file, characters, errors }
}

/** 由模型序列化出当前文件文本（只重写改动过的条目） */
export function saveCharacters(model: CharactersModel): string {
  return serialize(model.file)
}

// ---------- 修改操作 ----------

/** 设置/删除块里的标量值；value 为 null 时删除该条目 */
function setOrDeleteScalar(entry: CwItem, key: string, value: string | null): void {
  if (!entry.value || entry.value.kind !== 'block') return
  const it = findEntry(entry.value.items, key)
  if (value === null) {
    if (it) it.deleted = true
    return
  }
  if (it) {
    if (!it.value || it.value.kind !== 'scalar') return
    it.value.token.text = value
    it.value.token.end = value.length
    it.dirty = true
    it.deleted = false // 曾被删除的条目重新赋值时原地恢复
    return
  }
  // 曾被删除的同名条目：原地恢复（值更新、删除标记清除），保持行序不变
  const dead = findDeletedEntry(entry.value.items, key)
  if (dead && dead.value && dead.value.kind === 'scalar') {
    dead.value.token.text = value
    dead.value.token.end = value.length
    dead.deleted = false
    dead.dirty = true
    return
  }
  const ni = makeScalarEntry(key, value)
  // 块里已有条目时补一个换行 leading，避免粘在上一行行尾（换行符沿用文件自身的）
  if (entry.value.items.some((x) => !x.deleted)) {
    const nl = newlineOfBlock(entry)
    ni.leading = [{ kind: 'newline', text: nl, start: 0, end: nl.length }]
  }
  entry.value.items.push(ni)
  entry.dirty = true
}

/** 在块里追加一个新块条目（补 leading 换行；已有删除的同名块则原地恢复） */
function pushNewBlock(parent: CwItem, key: string): CwItem | null {
  if (!parent.value || parent.value.kind !== 'block') return null
  const dead = findDeletedEntry(parent.value.items, key)
  if (dead && dead.value?.kind === 'block') {
    dead.deleted = false
    dead.dirty = true
    return dead
  }
  const nb = makeBlockEntry(key, [])
  if (parent.value.items.some((x) => !x.deleted)) {
    const nl = newlineOfBlock(parent)
    nb.leading = [{ kind: 'newline', text: nl, start: 0, end: nl.length }]
  }
  parent.value.items.push(nb)
  parent.dirty = true
  return nb
}

/** 修改角色 id（条目键名；name/本地化键建议同步修改） */
export function setCharacterId(entry: CwItem, id: string): void {
  const key = id.trim()
  if (!key || !entry.key) return
  entry.key.text = key
  entry.key.end = key.length
  entry.dirty = true
}

export function setName(entry: CwItem, key: string): void {
  setOrDeleteScalar(entry, 'name', key.trim() === '' ? null : key.trim())
}

/**
 * 保持引号风格：原值带引号 → 新值也带引号；原值无引号 → 保持裸值；
 * 新增的肖像/日期值默认带引号（GFX 引用与日期的原版惯例是字符串）。
 */
function keepQuoted(parent: CwItem, key: string, value: string): string {
  if (value.startsWith('"')) return value
  if (!parent.value || parent.value.kind !== 'block') return value
  const it = findEntry(parent.value.items, key) ?? findDeletedEntry(parent.value.items, key)
  if (it && it.value?.kind === 'scalar') {
    const t = it.value.token.text
    if (!(t.startsWith('"') && t.endsWith('"'))) return value
  }
  return `"${value}"`
}

/**
 * 设置/删除肖像。sprite 为 null 时删除该槽；组（civilian/army/…）变空时删除整组，
 * 全部组清空时删除 portraits 块（再次赋值时原地恢复）。
 */
export function setPortrait(entry: CwItem, scope: string, size: 'small' | 'large', sprite: string | null): void {
  if (!entry.value || entry.value.kind !== 'block') return
  if (sprite === null) {
    const pb = findEntry(entry.value.items, 'portraits')
    if (!pb || pb.value?.kind !== 'block') return
    const sb = findEntry(pb.value.items, scope)
    if (!sb || sb.value?.kind !== 'block') return
    setOrDeleteScalar(sb, size, null)
    // 组变空 → 删除整组；全部组清空 → 删除 portraits 块
    if (!sb.value.items.some((x) => !x.deleted)) sb.deleted = true
    if (!pb.value.items.some((x) => !x.deleted)) pb.deleted = true
    return
  }
  let pb = findEntry(entry.value.items, 'portraits')
  if (!pb) pb = pushNewBlock(entry, 'portraits')
  if (!pb || pb.value?.kind !== 'block') return
  let sb = findEntry(pb.value.items, scope)
  if (!sb) sb = pushNewBlock(pb, scope)
  if (!sb || sb.value?.kind !== 'block') return
  setOrDeleteScalar(sb, size, keepQuoted(sb, size, sprite.trim()))
}

/** 添加一个肖像组（civilian/army/navy/…；空组由用户在组内填 small/large） */
export function addPortraitGroup(entry: CwItem, scope: string): void {
  if (!entry.value || entry.value.kind !== 'block') return
  const key = scope.trim()
  if (!key) return
  let pb = findEntry(entry.value.items, 'portraits')
  if (!pb) pb = pushNewBlock(entry, 'portraits')
  if (!pb || pb.value?.kind !== 'block') return
  if (!findEntry(pb.value.items, key)) pushNewBlock(pb, key)
}

/** 角色块里的标量字段（ideology/expire/slot/idea_token/skill/attack_skill/…） */
export function setRoleField(entry: CwItem, key: string, value: string | null): void {
  const role = roleBlockOf(entry)
  if (!role) return
  setOrDeleteScalar(role, key, value === null ? null : keepQuoted(role, key, value))
}

export function getRoleField(entry: CwItem, key: string): string | null {
  const role = roleBlockOf(entry)
  if (!role || !role.value || role.value.kind !== 'block') return null
  const it = findEntry(role.value.items, key)
  return it && it.value?.kind === 'scalar' ? it.value.token.text : null
}

function roleBlockOf(entry: CwItem): CwItem | null {
  if (!entry.value || entry.value.kind !== 'block') return null
  for (const rk of ROLE_KEYS) {
    const re = findEntry(entry.value.items, rk)
    if (re) return re
  }
  return null
}

/** 读取职位块的 traits 裸值列表（无 traits 块返回空数组） */
export function getTraitList(entry: CwItem): string[] {
  const role = roleBlockOf(entry)
  if (!role || !role.value || role.value.kind !== 'block') return []
  const traits = findEntry(role.value.items, 'traits')
  if (!traits || traits.value?.kind !== 'block') return []
  return traits.value.items
    .filter((x) => !x.deleted && x.kind === 'bare-item' && x.value?.kind === 'scalar')
    .map((x) => (x.value && x.value.kind === 'scalar' ? x.value.token.text : ''))
}

/** 追加一个特质。单行列表保持单行（traits = { A B }），多行列表新特质独占一行 */
export function addTrait(entry: CwItem, id: string): void {
  const role = roleBlockOf(entry)
  if (!role || !role.value || role.value.kind !== 'block') return
  const key = id.trim()
  if (!key) return
  let traits = findEntry(role.value.items, 'traits')
  if (!traits) traits = pushNewBlock(role, 'traits')
  if (!traits || traits.value?.kind !== 'block') return
  const list = traits.value.items
  if (list.some((x) => !x.deleted && x.value?.kind === 'scalar' && x.value.token.text === key)) return
  // 块是「干净单行」时新特质不加换行，保持单行渲染；否则独占一行
  const cleanSingle =
    list.every((x) => !x.deleted && !x.leading.some((t) => t.kind === 'newline')) &&
    list.every((x) => !x.deleted && !x.trailing.some((t) => t.kind === 'comment' || t.kind === 'newline')) &&
    !traits.value.preClose.some((t) => t.kind === 'comment' || t.kind === 'newline')
  const ni = makeBareItem(key)
  if (!cleanSingle) {
    const nl = newlineOfBlock(traits)
    ni.leading = [{ kind: 'newline', text: nl, start: 0, end: nl.length }]
  }
  list.push(ni)
  traits.dirty = true
}

export function removeTrait(entry: CwItem, id: string): void {
  const role = roleBlockOf(entry)
  if (!role || !role.value || role.value.kind !== 'block') return
  const traits = findEntry(role.value.items, 'traits')
  if (!traits || traits.value?.kind !== 'block') return
  const it = traits.value.items.find(
    (x) => !x.deleted && x.value?.kind === 'scalar' && x.value.token.text === id
  )
  if (it) it.deleted = true
}

/** 读取职位块里的条件/效果块（advisor 的 allowed / available / ai_will_do / visible） */
export function getCharacterCondBlock(entry: CwItem, key: string): CondNode[] | null {
  const role = roleBlockOf(entry)
  return role ? getCondBlockOf(role, key) : null
}

/** 整体替换职位块里的条件/效果块（结构化编辑保存） */
export function setCharacterCondBlock(entry: CwItem, key: string, nodes: CondNode[]): void {
  const role = roleBlockOf(entry)
  if (role) setCondBlockOf(role, key, nodes)
}

// ---------- 职位块增删 ----------

/** 各职位块的默认字段（新建职位时用） */
function roleDefaults(id: string, role: RoleKey): CwItem[] {
  if (role === 'country_leader') {
    return [
      makeScalarEntry('ideology', 'neutrality'),
      makeBlockEntry('traits', []),
      makeScalarEntry('expire', '1965.1.1.1', true)
    ]
  }
  if (role === 'field_marshal') {
    return [
      makeBlockEntry('traits', []),
      makeScalarEntry('skill', '1'),
      makeScalarEntry('attack_skill', '1'),
      makeScalarEntry('defense_skill', '1'),
      makeScalarEntry('planning_skill', '1'),
      makeScalarEntry('logistics_skill', '1')
    ]
  }
  if (role === 'advisor') {
    return [
      makeScalarEntry('slot', 'political_advisor'),
      makeScalarEntry('idea_token', `${id}_advisor`),
      makeBlockEntry('traits', []),
      makeScalarEntry('cost', '150')
    ]
  }
  return [makeBlockEntry('traits', [])]
}

/** 给角色加一个职位块（已有同类型职位时不动作） */
export function addRoleBlock(entry: CwItem, role: RoleKey): CwItem | null {
  if (!entry.value || entry.value.kind !== 'block') return null
  if (roleBlockOf(entry)) return null
  const nb = pushNewBlock(entry, role)
  if (!nb || nb.value?.kind !== 'block') return null
  for (const child of roleDefaults(entry.key?.text ?? '', role)) {
    if (nb.value.items.some((x) => !x.deleted)) {
      const nl = newlineOfBlock(nb)
      child.leading = [{ kind: 'newline', text: nl, start: 0, end: nl.length }]
    }
    nb.value.items.push(child)
  }
  nb.dirty = true
  return nb
}

/** 删除角色的职位块（可以撤销） */
export function removeRoleBlock(entry: CwItem): void {
  const role = roleBlockOf(entry)
  if (role) role.deleted = true
}

// ---------- 角色增删 ----------

export function addCharacter(model: CharactersModel, id: string): CwItem | null {
  const top = findEntry(model.file.items, 'characters')
  if (!top || top.value?.kind !== 'block') return null
  const ch = makeBlockEntry(id, [
    makeScalarEntry('name', id),
    makeBlockEntry('portraits', [makeBlockEntry('civilian', [makeScalarEntry('large', 'GFX_portrait_unknown', true)])]),
    makeBlockEntry('country_leader', [
      makeScalarEntry('ideology', 'neutrality'),
      makeBlockEntry('traits', []),
      makeScalarEntry('expire', '1965.1.1.1', true)
    ])
  ])
  if (top.value.items.some((x) => !x.deleted)) {
    const nl = newlineOfBlock(top)
    ch.leading = [{ kind: 'newline', text: nl, start: 0, end: nl.length }]
  }
  top.value.items.push(ch)
  top.dirty = true
  return ch
}

export function deleteCharacter(model: CharactersModel, id: string): void {
  // 每次重建：增删后 model.characters 是旧快照，直接查底层条目
  const def = buildCharacters(model.file).find((x) => x.id === id)
  if (!def) return
  def.entry.deleted = true
}

/** 建议一个新角色 id：${ns}_character_${i} 递增避占用 */
export function suggestCharacterId(model: CharactersModel, ns: string): string {
  const used = new Set(buildCharacters(model.file).map((x) => x.id))
  let i = 1
  while (used.has(`${ns}_character_${i}`)) i++
  return `${ns}_character_${i}`
}

/** 提取文件里全部角色 id（联动用） */
export function extractCharacterIds(source: string): string[] {
  const { file } = parseFile(source, 'txt')
  if (!file) return []
  return buildCharacters(file).map((x) => x.id)
}

/** 新建人物文件模板（\t 缩进；newline 指定换行符） */
export function createCharactersFile(ns: string, newline = '\n'): string {
  const nl = (n: number): string => '\t'.repeat(n) + newline
  return [
    `characters = {${newline}`,
    `${nl(1)}# ${ns} 示例人物${newline}`,
    `${nl(1)}${ns}_character_1 = {${newline}`,
    `${nl(2)}name = ${ns}_character_1${newline}`,
    `${nl(2)}portraits = {${newline}`,
    `${nl(3)}civilian = {${newline}`,
    `${nl(4)}large = "GFX_portrait_unknown"${newline}`,
    `${nl(3)}}${newline}`,
    `${nl(2)}}${newline}`,
    `${nl(2)}country_leader = {${newline}`,
    `${nl(3)}ideology = neutrality${newline}`,
    `${nl(3)}traits = { }${newline}`,
    `${nl(3)}expire = "1965.1.1.1"${newline}`,
    `${nl(2)}}${newline}`,
    `${nl(1)}}${newline}`,
    `}${newline}`
  ].join('')
}
