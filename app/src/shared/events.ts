/**
 * 事件文件数据模型 —— 在无损解析器之上提供事件（country_event / news_event 等）的读取与修改
 *
 * 事件文件顶层全是同键多块：country_event = { id = xxx } 与国策树的 focus = { id = xxx } 同构，
 * 复用同样的「键名是类型、块内 id 区分事件」约定。
 * 所有修改只标记相关条目 dirty；结构化编辑（trigger / immediate / 选项效果）整块重写为规范多行，
 * 其余字节原样保留。
 */

import { parseFile, serialize, findEntry, findDeletedEntry, scalarText, makeScalarEntry, makeBlockEntry, newlineOfBlock } from './clausewitz.ts'
import type { CwFile, CwItem, CwBlock } from './clausewitz.ts'
import { parseCondBlock, renderCondNodes, getCondBlockOf, setCondBlockOf } from './conditions.ts'
import type { CondNode } from './conditions.ts'

/** 支持的事件类型（键名） */
export const EVENT_TYPES = [
  'country_event',
  'news_event',
  'state_event',
  'unit_leader_event',
  'operative_leader_event',
  'decolonization_event'
]

export interface EventOption {
  /** 底层条目（option = { ... }） */
  entry: CwItem
  /** 选项名本地化键 */
  name: string
  hasTrigger: boolean
  hasAiChance: boolean
  /** 除 name/trigger/ai_chance 外还有效果 */
  hasEffects: boolean
}

export interface EventDef {
  /** 底层条目（country_event = { ... } 顶层块） */
  entry: CwItem
  /** 事件类型（键名） */
  type: string
  id: string
  /** 标题本地化键（缺失为 ''） */
  title: string
  /** 描述本地化键（缺失为 ''） */
  desc: string
  /** 事件图片（.gfx 精灵名，缺失为 ''） */
  picture: string
  major: boolean
  hidden: boolean
  fireOnlyOnce: boolean
  isTriggeredOnly: boolean
  hasTrigger: boolean
  hasMtth: boolean
  hasImmediate: boolean
  options: EventOption[]
}

export interface EventsModel {
  file: CwFile
  events: EventDef[]
  /** add_namespace 的值（无则 ''）；新事件 id 用它做前缀 */
  namespace: string
  errors: { message: string; line: number; col: number }[]
}

export function isEventType(key: string): boolean {
  return EVENT_TYPES.includes(key)
}

/** 选项块里的保留键（不属于「效果」，编辑效果时不动它们） */
const OPTION_RESERVED = new Set(['name', 'trigger', 'ai_chance'])

/** 每次调用都重新读取，保证拿到最新状态 */
export function buildEvents(file: CwFile): { events: EventDef[]; namespace: string } {
  const events: EventDef[] = []
  let namespace = ''
  for (const it of file.items) {
    if (it.deleted) continue
    if (it.kind !== 'entry' || !it.key || !it.value) continue
    if (it.key.text === 'add_namespace') {
      namespace = scalarText(it) ?? ''
      continue
    }
    if (it.value.kind !== 'block') continue
    if (!isEventType(it.key.text)) continue
    const items = it.value.items
    const id = scalarText(findEntry(items, 'id'))
    if (id === null) continue
    const options: EventOption[] = []
    for (const o of items) {
      if (o.deleted || !o.value || o.value.kind !== 'block' || (o.key?.text ?? '') !== 'option') continue
      options.push({
        entry: o,
        name: scalarText(findEntry(o.value.items, 'name')) ?? '',
        hasTrigger: !!findEntry(o.value.items, 'trigger'),
        hasAiChance: !!findEntry(o.value.items, 'ai_chance'),
        hasEffects: o.value.items.some((c) => !c.deleted && c.kind === 'entry' && c.key && !OPTION_RESERVED.has(c.key.text))
      })
    }
    events.push({
      entry: it,
      type: it.key.text,
      id,
      title: scalarText(findEntry(items, 'title')) ?? '',
      desc: scalarText(findEntry(items, 'desc')) ?? '',
      picture: scalarText(findEntry(items, 'picture')) ?? '',
      major: scalarText(findEntry(items, 'major')) === 'yes',
      hidden: scalarText(findEntry(items, 'hidden')) === 'yes',
      fireOnlyOnce: scalarText(findEntry(items, 'fire_only_once')) === 'yes',
      isTriggeredOnly: scalarText(findEntry(items, 'is_triggered_only')) === 'yes',
      hasTrigger: !!findEntry(items, 'trigger'),
      hasMtth: !!findEntry(items, 'mean_time_to_happen'),
      hasImmediate: !!findEntry(items, 'immediate'),
      options
    })
  }
  return { events, namespace }
}

/** 解析事件文件；没有事件条目时也返回模型（用于新建文件后的空态） */
export function loadEvents(source: string): EventsModel | null {
  const { file, errors } = parseFile(source, 'txt')
  if (!file) return null
  const { events, namespace } = buildEvents(file)
  return { file, events, namespace, errors }
}

/** 由模型序列化出当前文件文本（只重写改动过的条目） */
export function saveEvents(model: EventsModel): string {
  return serialize(model.file)
}

// ---------- 修改操作 ----------

/** 设置/删除事件块里的标量值；value 为 null 时删除该条目 */
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

export function setEventId(entry: CwItem, id: string): void {
  setOrDeleteScalar(entry, 'id', id.trim() === '' ? null : id.trim())
}

/** 修改事件类型（键名，如 country_event → news_event） */
export function setEventType(entry: CwItem, type: string): void {
  if (!entry.key || !isEventType(type)) return
  entry.key.text = type
  entry.key.end = type.length
  entry.dirty = true
}

export function setEventTitle(entry: CwItem, key: string): void {
  setOrDeleteScalar(entry, 'title', key.trim() === '' ? null : key.trim())
}

export function setEventDesc(entry: CwItem, key: string): void {
  setOrDeleteScalar(entry, 'desc', key.trim() === '' ? null : key.trim())
}

export function setEventPicture(entry: CwItem, sprite: string): void {
  setOrDeleteScalar(entry, 'picture', sprite.trim() === '' ? null : sprite.trim())
}

export function setEventFlag(entry: CwItem, key: string, on: boolean): void {
  setOrDeleteScalar(entry, key, on ? 'yes' : null)
}

/** 读取事件里的条件/效果块（trigger / mean_time_to_happen / immediate 等） */
export function getEventCondBlock(entry: CwItem, key: string): CondNode[] | null {
  return getCondBlockOf(entry, key)
}

/** 整体替换事件里的条件/效果块（结构化编辑保存） */
export function setEventCondBlock(entry: CwItem, key: string, nodes: CondNode[]): void {
  setCondBlockOf(entry, key, nodes)
}

// ---------- 选项 ----------

/** 读取选项块里的效果（不含 name/trigger/ai_chance） */
export function getOptionEffects(opt: CwItem): CondNode[] {
  if (!opt.value || opt.value.kind !== 'block') return []
  const fake: CwBlock = {
    kind: 'block',
    items: opt.value.items.filter((c) => !c.deleted && c.kind === 'entry' && c.key && !OPTION_RESERVED.has(c.key.text)),
    openToken: { kind: 'open', text: '{', start: 0, end: 1 },
    closeToken: null,
    preClose: []
  }
  return parseCondBlock(fake)
}

/**
 * 整体替换选项效果：删除保留键以外的全部条目，追加渲染出的新条目（整选项块重写）。
 * 新建条目沿用文件自身的换行符与缩进。
 */
export function setOptionEffects(opt: CwItem, nodes: CondNode[], newline: string): void {
  if (!opt.value || opt.value.kind !== 'block') return
  for (const it of opt.value.items) {
    if (it.kind === 'entry' && it.key && !OPTION_RESERVED.has(it.key.text)) it.deleted = true
  }
  const text = renderCondNodes(nodes, 0, newline)
  const parsed = parseFile(text, 'txt').file
  if (!parsed) return
  const markTreeDirty = (it: CwItem): void => {
    it.dirty = true
    if (it.value?.kind === 'block') for (const c of it.value.items) markTreeDirty(c)
  }
  for (const it of parsed.items) markTreeDirty(it)
  // 首个效果条目补换行 leading，避免与选项里保留键（name 等）的上一行粘在一起
  if (parsed.items.length > 0) {
    parsed.items[0].leading = [{ kind: 'newline', text: newline, start: 0, end: newline.length }]
    opt.value.items.push(...parsed.items)
  }
  opt.dirty = true
}

export function setOptionName(opt: CwItem, key: string): void {
  setOrDeleteScalar(opt, 'name', key.trim() === '' ? null : key.trim())
}

export function addOption(eventEntry: CwItem, nameKey: string, newline = '\n'): CwItem {
  const opt = makeBlockEntry('option', [makeScalarEntry('name', nameKey)])
  opt.leading = [
    { kind: 'newline', text: newline, start: 0, end: newline.length },
    { kind: 'space', text: '\t', start: 0, end: 1 }
  ]
  if (!eventEntry.value || eventEntry.value.kind !== 'block') return opt
  eventEntry.value.items.push(opt)
  eventEntry.dirty = true
  return opt
}

export function deleteOption(opt: CwItem): void {
  opt.deleted = true
}

// ---------- 事件增删 ----------

/** 新建事件并追加到文件末尾（游戏标准格式）；返回其条目 */
export function addEvent(model: EventsModel, type: string, id: string): CwItem {
  const nl = model.file.newline
  const entry = makeBlockEntry(isEventType(type) ? type : 'country_event', [makeScalarEntry('id', id)])
  entry.leading = [{ kind: 'newline', text: nl, start: 0, end: nl.length }]
  model.file.items.push(entry)
  return entry
}

/** 删除事件（按 id 找第一个匹配） */
export function deleteEvent(model: EventsModel, id: string): void {
  const target = buildEvents(model.file).events.find((e) => e.id === id)
  if (target) target.entry.deleted = true
}

export function hasEvent(model: EventsModel, id: string): boolean {
  return buildEvents(model.file).events.some((e) => e.id === id)
}

/** 生成未被占用的事件 id：命名空间 + 递增序号（如 france.3） */
export function suggestEventId(model: EventsModel): string {
  const ns = model.namespace || 'event'
  let i = 1
  while (hasEvent(model, `${ns}.${i}`)) i++
  return `${ns}.${i}`
}

/** 提取事件文件里全部事件 id（联动用） */
export function extractEventIds(source: string): string[] {
  const m = loadEvents(source)
  return m ? m.events.map((e) => e.id) : []
}

/** 按命名空间生成未被占用的全局事件 id（跨文件扫描用，避开全部已有 id；如 france.2） */
export function suggestGlobalEventId(existing: Iterable<string>, namespace: string): string {
  // sanitize 后全为下划线（如纯中文名）视为无效，用兜底命名空间；小写与新建事件文件模板的约定一致
  const ns = namespace.replace(/[^A-Za-z0-9_]/g, '_').replace(/^_+$/, '').toLowerCase() || 'event'
  // 占用判定不区分大小写（游戏内事件 id 大小写不敏感，避免同一事件出现两份）
  const used = new Set<string>()
  for (const id of existing) used.add(id.toLowerCase())
  let i = 1
  while (used.has(`${ns}.${i}`)) i++
  return `${ns}.${i}`
}

/** 新建事件文件的初始内容（游戏标准格式，\t 缩进） */
export function createEventsFile(namespace: string, newline = '\n'): string {
  const ns = namespace.trim() || 'event'
  return [
    `add_namespace = ${ns}`,
    '',
    'country_event = {',
    `\tid = ${ns}.1`,
    `\ttitle = ${ns}.1.t`,
    `\tdesc = ${ns}.1.d`,
    '\tis_triggered_only = yes',
    '\toption = {',
    `\t\tname = ${ns}.1.a`,
    '\t}',
    '}',
    ''
  ].join(newline)
}
