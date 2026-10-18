/**
 * 民族精神（national spirits / ideas）文件数据模型 —— 在无损解析器之上提供读取与修改
 *
 * ideas 文件顶层是 ideas = { ... } 块，块内是「分类块」（country / political_advisor / …），
 * 分类块内每个条目就是一个民族精神（条目键名 = 精神 id，如 FRA_general_strike = { ... }）。
 * 精神块常用字段：picture（图标）、allowed（条件）、modifier（修饰符标量集合）、
 * on_add / on_remove（添加/移除效果）。所有修改只标记相关条目 dirty；
 * 结构化编辑（allowed / on_add / on_remove）整块重写，其余字节原样保留。
 */

import { parseFile, serialize, findEntry, findDeletedEntry, makeScalarEntry, makeBlockEntry, newlineOfBlock } from './clausewitz.ts'
import type { CwFile, CwItem } from './clausewitz.ts'
import { getCondBlockOf, setCondBlockOf } from './conditions.ts'
import type { CondNode } from './conditions.ts'

export interface IdeaDef {
  /** 底层条目（精神块，如 FRA_general_strike = { ... }） */
  entry: CwItem
  /** 所属分类名（分类块键名，如 country） */
  category: string
  /** 精神 id（条目键名；本地化标题键 = id、描述键 = id_desc） */
  id: string
  /** 图标精灵名（缺失为 ''） */
  picture: string
  hasAllowed: boolean
  hasModifier: boolean
  hasOnAdd: boolean
  hasOnRemove: boolean
}

export interface IdeasModel {
  file: CwFile
  ideas: IdeaDef[]
  /** 分类名（按文件出现顺序） */
  categories: string[]
  errors: { message: string; line: number; col: number }[]
}

/** 每次调用都重新读取，保证拿到最新状态 */
export function buildIdeas(file: CwFile): { ideas: IdeaDef[]; categories: string[] } {
  const ideas: IdeaDef[] = []
  const categories: string[] = []
  const top = findEntry(file.items, 'ideas')
  if (top && top.value?.kind === 'block') {
    for (const cat of top.value.items) {
      if (cat.deleted || !cat.key || cat.value?.kind !== 'block') continue
      categories.push(cat.key.text)
      for (const it of cat.value.items) {
        if (it.deleted || !it.key || it.value?.kind !== 'block') continue
        const items = it.value.items
        const pic = findEntry(items, 'picture')
        ideas.push({
          entry: it,
          category: cat.key.text,
          id: it.key.text,
          picture: pic && pic.value?.kind === 'scalar' ? pic.value.token.text : '',
          hasAllowed: !!findEntry(items, 'allowed'),
          hasModifier: !!findEntry(items, 'modifier'),
          hasOnAdd: !!findEntry(items, 'on_add'),
          hasOnRemove: !!findEntry(items, 'on_remove')
        })
      }
    }
  }
  return { ideas, categories }
}

/** 解析民族精神文件；没有精神条目时也返回模型（用于新建文件后的空态） */
export function loadIdeas(source: string): IdeasModel | null {
  const { file, errors } = parseFile(source, 'txt')
  if (!file) return null
  const { ideas, categories } = buildIdeas(file)
  return { file, ideas, categories, errors }
}

/** 由模型序列化出当前文件文本（只重写改动过的条目） */
export function saveIdeas(model: IdeasModel): string {
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

/** 修改精神 id（条目键名；本地化键随之变化） */
export function setIdeaId(entry: CwItem, id: string): void {
  const key = id.trim()
  if (!key || !entry.key) return
  entry.key.text = key
  entry.key.end = key.length
  entry.dirty = true
}

export function setIdeaPicture(entry: CwItem, sprite: string): void {
  setOrDeleteScalar(entry, 'picture', sprite.trim() === '' ? null : sprite.trim())
}

/** 读取精神里的条件/效果块（allowed / on_add / on_remove） */
export function getIdeaCondBlock(entry: CwItem, key: string): CondNode[] | null {
  return getCondBlockOf(entry, key)
}

/** 整体替换精神里的条件/效果块（结构化编辑保存） */
export function setIdeaCondBlock(entry: CwItem, key: string, nodes: CondNode[]): void {
  setCondBlockOf(entry, key, nodes)
}

// ---------- modifier 修饰符行 ----------

export interface ModifierRow {
  key: string
  /** scalar = 可编辑的数值行；block = 嵌套块（只读展示） */
  kind: 'scalar' | 'block'
  /** 标量的当前值文本；block 为 '' */
  text: string
  /** 行尾注释原文（含 #，没有则为 null） */
  comment: string | null
  entry: CwItem
}

/** 读取精神 modifier 块的行列表（含嵌套块，保持文件顺序） */
export function getModifierRows(ideaEntry: CwItem): ModifierRow[] {
  if (!ideaEntry.value || ideaEntry.value.kind !== 'block') return []
  const mod = findEntry(ideaEntry.value.items, 'modifier')
  if (!mod || mod.value?.kind !== 'block') return []
  return mod.value.items
    .filter((it) => !it.deleted && it.key)
    .map((it) => ({
      key: it.key!.text,
      kind: it.value?.kind === 'block' ? 'block' : 'scalar',
      text: it.value?.kind === 'scalar' ? it.value.token.text : '',
      comment: it.trailing.find((t) => t.kind === 'comment')?.text ?? null,
      entry: it
    }))
}

/**
 * 增/改/删精神 modifier 块里的一行标量；value 为 null 时删除整行（含行尾注释）。
 * 改值时行尾注释原地保留；新行用文件自身的换行符。
 */
export function setModifierRow(ideaEntry: CwItem, key: string, value: string | null): void {
  if (!ideaEntry.value || ideaEntry.value.kind !== 'block') return
  const mod = findEntry(ideaEntry.value.items, 'modifier')
  if (!mod || mod.value?.kind !== 'block') return
  setOrDeleteScalar(mod, key, value)
}

/** 改修饰符行的键名（原地改 key token：行序、行尾注释、值都不动） */
export function renameModifierRow(ideaEntry: CwItem, oldKey: string, newKey: string): void {
  if (!ideaEntry.value || ideaEntry.value.kind !== 'block') return
  const mod = findEntry(ideaEntry.value.items, 'modifier')
  if (!mod || mod.value?.kind !== 'block') return
  const row = findEntry(mod.value.items, oldKey)
  const nk = newKey.trim()
  if (!row || !row.key || !nk || nk === oldKey) return
  row.key.text = nk
  row.key.end = nk.length
  row.dirty = true
}

// ---------- 分类与精神增删 ----------

function findCategory(model: IdeasModel, name: string): CwItem | null {
  const top = findEntry(model.file.items, 'ideas')
  if (!top || top.value?.kind !== 'block') return null
  return findEntry(top.value.items, name)
}

export function addCategory(model: IdeasModel, name: string): CwItem | null {
  const top = findEntry(model.file.items, 'ideas')
  if (!top || top.value?.kind !== 'block') return top
  const cat = makeBlockEntry(name, [])
  if (top.value.items.some((x) => !x.deleted)) {
    const nl = newlineOfBlock(top)
    cat.leading = [{ kind: 'newline', text: nl, start: 0, end: nl.length }]
  }
  top.value.items.push(cat)
  top.dirty = true
  return cat
}

/** 删除空分类；分类里还有精神时拒绝 */
export function deleteCategory(model: IdeasModel, name: string): boolean {
  const top = findEntry(model.file.items, 'ideas')
  if (!top || top.value?.kind !== 'block') return false
  const cat = findEntry(top.value.items, name)
  if (!cat || cat.value?.kind !== 'block') return false
  if (cat.value.items.some((x) => !x.deleted && x.value?.kind === 'block')) return false
  cat.deleted = true
  return true
}

export function addIdea(model: IdeasModel, category: string, id: string): CwItem | null {
  let cat = findCategory(model, category)
  if (!cat) cat = addCategory(model, category)
  if (!cat || cat.value?.kind !== 'block') return null
  const idea = makeBlockEntry(id, [makeScalarEntry('picture', 'generic_communism')])
  if (cat.value.items.some((x) => !x.deleted)) {
    const nl = newlineOfBlock(cat)
    idea.leading = [{ kind: 'newline', text: nl, start: 0, end: nl.length }]
  }
  cat.value.items.push(idea)
  cat.dirty = true
  return idea
}

/**
 * 把精神移到另一个分类块。
 * 浅拷贝共享值树与 leading：原偏移仍有效（移动块序列化 = 原字节），
 * 原位置的空行等 leading 也一并保留——移回原分类后可逐字节还原。
 */
export function moveIdea(model: IdeasModel, id: string, newCategory: string): void {
  const d = buildIdeas(model.file).ideas.find((x) => x.id === id)
  if (!d || d.category === newCategory) return
  const cat = findCategory(model, newCategory)
  if (!cat || cat.value?.kind !== 'block') return
  const copy: CwItem = { ...d.entry }
  d.entry.deleted = true
  // 原分类标记 dirty：重渲染时去掉被移走的块
  const oldCat = findCategory(model, d.category)
  if (oldCat) oldCat.dirty = true
  cat.value.items.push(copy)
  cat.dirty = true
}

export function deleteIdea(model: IdeasModel, id: string): void {
  // 每次重建：增删后 model.ideas 是旧快照，直接查底层条目
  const def = buildIdeas(model.file).ideas.find((x) => x.id === id)
  if (!def) return
  def.entry.deleted = true
}

export function hasIdea(model: IdeasModel, id: string): boolean {
  return buildIdeas(model.file).ideas.some((x) => x.id === id)
}

/** 建议一个新精神 id：${ns}_idea_${i} 递增避占用 */
export function suggestIdeaId(model: IdeasModel, ns: string): string {
  const used = new Set(buildIdeas(model.file).ideas.map((x) => x.id))
  let i = 1
  while (used.has(`${ns}_idea_${i}`)) i++
  return `${ns}_idea_${i}`
}

/** 提取文件里全部精神 id（联动用） */
export function extractIdeaIds(source: string): string[] {
  const { file } = parseFile(source, 'txt')
  if (!file) return []
  return buildIdeas(file).ideas.map((x) => x.id)
}

/** 新建民族精神文件模板（\t 缩进；newline 指定换行符） */
export function createIdeasFile(ns: string, newline = '\n'): string {
  const nl = (n: number): string => '\t'.repeat(n) + newline
  return [
    `ideas = {${newline}`,
    `\tcountry = {${newline}`,
    `\t\t${ns}_idea_1 = {${newline}`,
    `\t\t\tpicture = generic_communism${newline}`,
    `${nl(3)}modifier = {${newline}`,
    `\t\t\t\tstability_factor = 0.1${newline}`,
    `\t\t\t}${newline}`,
    `\t\t}${newline}`,
    `\t}${newline}`,
    `}${newline}`
  ].join('')
}
