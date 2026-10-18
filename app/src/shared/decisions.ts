/**
 * 决议文件数据模型 —— 在无损解析器之上提供决议（decision）的读取与修改
 *
 * 决议文件顶层是「分类块」：FRA_low_countries_category = { ... }，
 * 块内每个条目就是一个决议（条目键名 = 决议 id，如 FRA_pull_belgium = { ... }）。
 * 分类元数据（allowed/icon/color）在同目录 categories/*.txt 里，本模块只编辑决议文件本身。
 * 所有修改只标记相关条目 dirty；结构化编辑（visible/available/complete_effect 等）整块重写，
 * 其余字节原样保留。
 */

import { parseFile, serialize, findEntry, findDeletedEntry, scalarText, makeScalarEntry, makeBlockEntry, newlineOfBlock } from './clausewitz.ts'
import type { CwFile, CwItem } from './clausewitz.ts'
import { getCondBlockOf, setCondBlockOf } from './conditions.ts'
import type { CondNode } from './conditions.ts'

export interface DecisionDef {
  /** 底层条目（决议块，如 FRA_pull_belgium = { ... }） */
  entry: CwItem
  /** 所属分类块（顶层条目） */
  categoryEntry: CwItem
  /** 分类名（分类块键名） */
  category: string
  /** 决议 id（条目键名；本地化标题键 = id、描述键 = id_desc） */
  id: string
  /** 图标精灵名（缺失为 ''） */
  icon: string
  /** 政治点数消耗（缺失为 ''） */
  cost: string
  /** 执行后移除天数（缺失为 ''） */
  daysRemove: string
  /** 再次可用冷却天数（缺失为 ''） */
  daysReEnable: string
  fireOnlyOnce: boolean
  /** 目标决议（targeted = yes，对州/国家生效） */
  isTargeted: boolean
  hasVisible: boolean
  hasAvailable: boolean
  hasAllowed: boolean
  hasCompleteEffect: boolean
  hasRemoveEffect: boolean
  hasAiWillDo: boolean
  hasModifier: boolean
  hasTargetedModifier: boolean
}

export interface DecisionsModel {
  file: CwFile
  decisions: DecisionDef[]
  /** 分类名（按文件出现顺序） */
  categories: string[]
  errors: { message: string; line: number; col: number }[]
}

/** 每次调用都重新读取，保证拿到最新状态 */
export function buildDecisions(file: CwFile): { decisions: DecisionDef[]; categories: string[] } {
  const decisions: DecisionDef[] = []
  const categories: string[] = []
  for (const it of file.items) {
    if (it.deleted || it.kind !== 'entry' || !it.key || !it.value || it.value.kind !== 'block') continue
    const name = it.key.text
    categories.push(name)
    for (const d of it.value.items) {
      if (d.deleted || d.kind !== 'entry' || !d.key || !d.value || d.value.kind !== 'block') continue
      const items = d.value.items
      decisions.push({
        entry: d,
        categoryEntry: it,
        category: name,
        id: d.key.text,
        icon: scalarText(findEntry(items, 'icon')) ?? '',
        cost: scalarText(findEntry(items, 'cost')) ?? '',
        daysRemove: scalarText(findEntry(items, 'days_remove')) ?? '',
        daysReEnable: scalarText(findEntry(items, 'days_re_enable')) ?? '',
        fireOnlyOnce: scalarText(findEntry(items, 'fire_only_once')) === 'yes',
        isTargeted: scalarText(findEntry(items, 'targeted')) === 'yes',
        hasVisible: !!findEntry(items, 'visible'),
        hasAvailable: !!findEntry(items, 'available'),
        hasAllowed: !!findEntry(items, 'allowed'),
        hasCompleteEffect: !!findEntry(items, 'complete_effect'),
        hasRemoveEffect: !!findEntry(items, 'remove_effect'),
        hasAiWillDo: !!findEntry(items, 'ai_will_do'),
        hasModifier: !!findEntry(items, 'modifier'),
        hasTargetedModifier: !!findEntry(items, 'targeted_modifier')
      })
    }
  }
  return { decisions, categories }
}

/** 解析决议文件；没有决议条目时也返回模型（用于新建文件后的空态） */
export function loadDecisions(source: string): DecisionsModel | null {
  const { file, errors } = parseFile(source, 'txt')
  if (!file) return null
  const { decisions, categories } = buildDecisions(file)
  return { file, decisions, categories, errors }
}

/** 由模型序列化出当前文件文本（只重写改动过的条目） */
export function saveDecisions(model: DecisionsModel): string {
  return serialize(model.file)
}

// ---------- 修改操作 ----------

/** 设置/删除决议块里的标量值；value 为 null 时删除该条目 */
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

/** 修改决议 id（条目键名；本地化键随之变化） */
export function setDecisionId(entry: CwItem, id: string): void {
  const key = id.trim()
  if (!key || !entry.key) return
  entry.key.text = key
  entry.key.end = key.length
  entry.dirty = true
}

export function setDecisionIcon(entry: CwItem, sprite: string): void {
  setOrDeleteScalar(entry, 'icon', sprite.trim() === '' ? null : sprite.trim())
}

export function setDecisionCost(entry: CwItem, text: string): void {
  setOrDeleteScalar(entry, 'cost', text.trim() === '' ? null : text.trim())
}

/** 修改 days_remove / days_re_enable */
export function setDecisionDays(entry: CwItem, key: string, text: string): void {
  setOrDeleteScalar(entry, key, text.trim() === '' ? null : text.trim())
}

/** 开关标志（fire_only_once / targeted）：开写 yes，关删条目 */
export function setDecisionFlag(entry: CwItem, key: string, on: boolean): void {
  setOrDeleteScalar(entry, key, on ? 'yes' : null)
}

/** 读取决议里的条件/效果块（visible / available / complete_effect 等） */
export function getDecisionCondBlock(entry: CwItem, key: string): CondNode[] | null {
  return getCondBlockOf(entry, key)
}

/** 整体替换决议里的条件/效果块（结构化编辑保存） */
export function setDecisionCondBlock(entry: CwItem, key: string, nodes: CondNode[]): void {
  setCondBlockOf(entry, key, nodes)
}

// ---------- 分类与决议增删 ----------

function findCategory(model: DecisionsModel, name: string): CwItem | null {
  return (
    model.file.items.find(
      (it) => !it.deleted && it.kind === 'entry' && it.key?.text === name && it.value?.kind === 'block'
    ) ?? null
  )
}

/** 新建空分类块并追加到文件末尾；返回其条目 */
export function addCategory(model: DecisionsModel, name: string): CwItem {
  const nl = model.file.newline
  const entry = makeBlockEntry(name)
  entry.leading =
    model.file.items.length > 0
      ? [{ kind: 'newline', text: nl, start: 0, end: nl.length }]
      : []
  model.file.items.push(entry)
  return entry
}

/** 删除空分类块；分类里还有决议时不操作（返回是否删除成功） */
export function deleteCategory(model: DecisionsModel, name: string): boolean {
  const cat = findCategory(model, name)
  if (!cat) return false
  if (buildDecisions(model.file).decisions.some((d) => d.category === name)) return false
  cat.deleted = true
  return true
}

/** 新建决议并追加到分类块末尾（游戏标准格式）；返回其条目 */
export function addDecision(model: DecisionsModel, category: string, id: string): CwItem {
  const nl = model.file.newline
  const children = [
    makeScalarEntry('icon', 'generic_decision'),
    makeScalarEntry('cost', '50'),
    makeScalarEntry('fire_only_once', 'yes'),
    makeBlockEntry('ai_will_do', [makeScalarEntry('factor', '1')])
  ]
  const entry = makeBlockEntry(id, children)
  entry.leading = [
    { kind: 'newline', text: nl, start: 0, end: nl.length },
    { kind: 'space', text: '\t', start: 0, end: 1 }
  ]
  const cat = findCategory(model, category)
  if (cat && cat.value && cat.value.kind === 'block') {
    cat.value.items.push(entry)
    cat.dirty = true
  }
  return entry
}

/** 删除决议（按 id 找第一个匹配） */
export function deleteDecision(model: DecisionsModel, id: string): void {
  const target = buildDecisions(model.file).decisions.find((d) => d.id === id)
  if (target) target.entry.deleted = true
}

/**
 * 把决议移到另一个分类块：按原字节复制条目本体（浅拷贝共享 value 树，
 * rawStart/rawEnd 偏移仍指向原文件，序列化时按原字节切片），原块删除、目标块追加。
 * 注释/空行留在原分类里，不随决议移动。
 */
export function moveDecision(model: DecisionsModel, id: string, newCategory: string): void {
  const d = buildDecisions(model.file).decisions.find((x) => x.id === id)
  if (!d || d.category === newCategory) return
  const cat = findCategory(model, newCategory)
  if (!cat || !cat.value || cat.value.kind !== 'block') return
  const nl = model.file.newline
  const copy: CwItem = {
    ...d.entry,
    leading: [
      { kind: 'newline', text: nl, start: 0, end: nl.length },
      { kind: 'space', text: '\t', start: 0, end: 1 }
    ]
  }
  d.entry.deleted = true
  d.categoryEntry.dirty = true
  cat.value.items.push(copy)
  cat.dirty = true
}

export function hasDecision(model: DecisionsModel, id: string): boolean {
  return buildDecisions(model.file).decisions.some((d) => d.id === id)
}

/** 生成未被占用的决议 id：大写的模组命名空间 + 递增序号（如 PARIS_COMMUNE_decision_1） */
export function suggestDecisionId(model: DecisionsModel, ns: string): string {
  const prefix = `${(ns.trim() || 'decision').toUpperCase()}_decision_`
  let i = 1
  while (hasDecision(model, `${prefix}${i}`)) i++
  return `${prefix}${i}`
}

/** 提取决议文件里全部决议 id（联动用） */
export function extractDecisionIds(source: string): string[] {
  const m = loadDecisions(source)
  return m ? m.decisions.map((d) => d.id) : []
}

/** 新建决议文件的初始内容（游戏标准格式，\t 缩进，与用户现有决议文件一致的 LF 换行） */
export function createDecisionsFile(ns: string, newline = '\n'): string {
  const tag = (ns.trim() || 'decision').toUpperCase()
  return [
    `# ===== ${tag} 决议 =====`,
    '',
    `${tag}_decision_category = {`,
    '',
    `\t${tag}_example_decision = {`,
    '\t\ticon = generic_decision',
    '\t\tcost = 50',
    '\t\tfire_only_once = yes',
    '\t\tvisible = { }',
    '\t\tcomplete_effect = { }',
    '\t\tai_will_do = {',
    '\t\t\tfactor = 1',
    '\t\t}',
    '\t}',
    '}',
    ''
  ].join(newline)
}
