/**
 * 领导人特质（country_leader traits）文件数据模型 —— 在无损解析器之上提供读取与修改
 *
 * traits 文件顶层是 leader_traits = { ... } 块，块内每个条目就是一个特质
 * （条目键名 = 特质 id，如 FRA_marcel_cachin_trait = { ... }）。
 * 特质块字段：random（标量）、若干修饰符标量、ai_will_do（条件块）。
 * 修饰符行编辑与民族精神的 modifier 行机制一致：改值行尾注释原地保留、
 * 新行用文件自身的换行符、删除后重新赋值原地恢复。
 */

import { parseFile, serialize, findEntry, findDeletedEntry, makeScalarEntry, makeBlockEntry, newlineOfBlock } from './clausewitz.ts'
import type { CwFile, CwItem } from './clausewitz.ts'
import { getCondBlockOf, setCondBlockOf } from './conditions.ts'
import type { CondNode } from './conditions.ts'

export interface TraitRow {
  key: string
  /** scalar = 可编辑的数值行；block = 嵌套块（只读展示） */
  kind: 'scalar' | 'block'
  /** 标量的当前值文本；block 为 '' */
  text: string
  /** 行尾注释原文（含 #，没有则为 null） */
  comment: string | null
  entry: CwItem
}

export interface TraitDef {
  /** 底层条目（特质块） */
  entry: CwItem
  id: string
  /** random 字段文本（缺失为 ''） */
  random: string
  hasAiWillDo: boolean
}

export interface TraitsModel {
  file: CwFile
  traits: TraitDef[]
  errors: { message: string; line: number; col: number }[]
}

/** 每次调用都重新读取，保证拿到最新状态 */
export function buildTraits(file: CwFile): TraitDef[] {
  const traits: TraitDef[] = []
  const top = findEntry(file.items, 'leader_traits')
  if (top && top.value?.kind === 'block') {
    for (const it of top.value.items) {
      if (it.deleted || !it.key || it.value?.kind !== 'block') continue
      const items = it.value.items
      const random = findEntry(items, 'random')
      traits.push({
        entry: it,
        id: it.key.text,
        random: random && random.value?.kind === 'scalar' ? random.value.token.text : '',
        hasAiWillDo: !!findEntry(items, 'ai_will_do')
      })
    }
  }
  return traits
}

/** 解析特质文件；没有特质条目时也返回模型（用于新建文件后的空态） */
export function loadTraits(source: string): TraitsModel | null {
  const { file, errors } = parseFile(source, 'txt')
  if (!file) return null
  const traits = buildTraits(file)
  return { file, traits, errors }
}

/** 由模型序列化出当前文件文本（只重写改动过的条目） */
export function saveTraits(model: TraitsModel): string {
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

export function setTraitId(entry: CwItem, id: string): void {
  const key = id.trim()
  if (!key || !entry.key) return
  entry.key.text = key
  entry.key.end = key.length
  entry.dirty = true
}

export function setTraitRandom(entry: CwItem, value: string | null): void {
  setOrDeleteScalar(entry, 'random', value === null || value.trim() === '' ? null : value.trim())
}

/** 读取特质块的修饰符行（random 与 ai_will_do 除外，保持文件顺序） */
export function getTraitRows(traitEntry: CwItem): TraitRow[] {
  if (!traitEntry.value || traitEntry.value.kind !== 'block') return []
  return traitEntry.value.items
    .filter((it) => !it.deleted && it.key && it.key.text !== 'random' && it.key.text !== 'ai_will_do')
    .map((it) => ({
      key: it.key!.text,
      kind: it.value?.kind === 'block' ? 'block' : 'scalar',
      text: it.value?.kind === 'scalar' ? it.value.token.text : '',
      comment: it.trailing.find((t) => t.kind === 'comment')?.text ?? null,
      entry: it
    }))
}

/** 增/改/删特质块里的一行标量；value 为 null 时删除整行（含行尾注释） */
export function setTraitRow(traitEntry: CwItem, key: string, value: string | null): void {
  setOrDeleteScalar(traitEntry, key, value)
}

/** 改修饰符行的键名（原地改 key token：行序、行尾注释、值都不动） */
export function renameTraitRow(traitEntry: CwItem, oldKey: string, newKey: string): void {
  if (!traitEntry.value || traitEntry.value.kind !== 'block') return
  const row = findEntry(traitEntry.value.items, oldKey)
  const nk = newKey.trim()
  if (!row || !row.key || !nk || nk === oldKey) return
  row.key.text = nk
  row.key.end = nk.length
  row.dirty = true
}

/** 读取特质里的条件块（ai_will_do） */
export function getTraitCondBlock(entry: CwItem, key: string): CondNode[] | null {
  return getCondBlockOf(entry, key)
}

/** 整体替换特质里的条件块（结构化编辑保存） */
export function setTraitCondBlock(entry: CwItem, key: string, nodes: CondNode[]): void {
  setCondBlockOf(entry, key, nodes)
}

// ---------- 特质增删 ----------

export function addTrait(model: TraitsModel, id: string): CwItem | null {
  const top = findEntry(model.file.items, 'leader_traits')
  if (!top || top.value?.kind !== 'block') return null
  const t = makeBlockEntry(id, [
    makeScalarEntry('random', 'no'),
    makeScalarEntry('stability_factor', '0.1'),
    makeBlockEntry('ai_will_do', [makeScalarEntry('factor', '0')])
  ])
  if (top.value.items.some((x) => !x.deleted)) {
    const nl = newlineOfBlock(top)
    t.leading = [{ kind: 'newline', text: nl, start: 0, end: nl.length }]
  }
  top.value.items.push(t)
  top.dirty = true
  return t
}

export function deleteTrait(model: TraitsModel, id: string): void {
  const def = buildTraits(model.file).find((x) => x.id === id)
  if (!def) return
  def.entry.deleted = true
}

/** 建议一个新特质 id：${ns}_trait_${i} 递增避占用 */
export function suggestTraitId(model: TraitsModel, ns: string): string {
  const used = new Set(buildTraits(model.file).map((x) => x.id))
  let i = 1
  while (used.has(`${ns}_trait_${i}`)) i++
  return `${ns}_trait_${i}`
}

/** 提取文件里全部特质 id（人物编辑器 traits 自动补全用） */
export function extractTraitIds(source: string): string[] {
  const { file } = parseFile(source, 'txt')
  if (!file) return []
  return buildTraits(file).map((x) => x.id)
}

/** 新建特质文件模板（\t 缩进；newline 指定换行符） */
export function createTraitsFile(ns: string, newline = '\n'): string {
  const nl = (n: number): string => '\t'.repeat(n) + newline
  return [
    `leader_traits = {${newline}`,
    `${nl(1)}# ${ns} 示例领导人特质${newline}`,
    `${nl(1)}${ns}_leader_trait = {${newline}`,
    `${nl(2)}random = no${newline}`,
    `${nl(2)}stability_factor = 0.1${newline}`,
    `${nl(2)}ai_will_do = {${newline}`,
    `${nl(3)}factor = 0${newline}`,
    `${nl(2)}}${newline}`,
    `${nl(1)}}${newline}`,
    `}${newline}`
  ].join('')
}
