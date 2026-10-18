/**
 * 国策树数据模型 —— 在无损解析器之上提供国策节点的读取与修改
 *
 * 所有修改只标记相关条目 dirty，序列化时未修改的字节原样保留（硬性要求之一）。
 * 编辑流程（含撤销/重做）：修改前 serialize() 存档，修改后 serialize() 输出；
 * 撤销 = 用存档字符串重新 parseFile（往返无损已由测试保证）。
 */

import {
  parseFile,
  serialize,
  findEntry,
  scalarText,
  setScalar,
  setString,
  makeScalarEntry,
  makeBlockEntry,
  makeBareItem
} from './clausewitz.ts'
import type { CwFile, CwItem, CwBlock } from './clausewitz.ts'
import { getCondBlockOf, setCondBlockOf } from './conditions.ts'
import type { CondNode } from './conditions.ts'

export interface FocusNode {
  id: string
  /** 底层条目（供编辑器直接修改/渲染） */
  entry: CwItem
  x: number
  y: number
  cost: number
  icon: string
  prerequisites: string[]
  mutuallyExclusive: string[]
  relativePositionId: string | null
  availableIfCapitulated: boolean
  cancelIfInvalid: boolean
  searchFilters: string[]
  hasAvailable: boolean
  hasCompletionReward: boolean
  hasBypass: boolean
  hasCancel: boolean
}

export interface FocusTreeModel {
  file: CwFile
  /** 根块（包含全部国策条目的块） */
  root: CwBlock
  nodes: FocusNode[]
  /** 解析错误列表（与 clausewitz 的 ParseResult.errors 相同） */
  errors: { message: string; line: number; col: number }[]
}

function num(v: string | null, dft: number): number {
  if (v === null) return dft
  const n = Number(v)
  return Number.isFinite(n) ? n : dft
}

function listOf(entry: CwItem, key: string): string[] {
  const it = findEntry(entry.value?.kind === 'block' ? entry.value.items : [], key)
  if (!it || it.deleted || !it.value || it.value.kind !== 'block') return []
  return it.value.items
    .filter((c) => !c.deleted)
    .map((c) => scalarText(c))
    .filter((s): s is string => s !== null)
}

/** 根块顶层里不算国策的元条目键名 */
const META_KEYS = new Set(['id', 'country', 'default', 'continuous_focus_position', 'initial_show_position', 'shortcut', 'inlay_window'])

/** 取条目的国策 id：focus = { id = XXX } 用块内 id；旧式「XXX = { }」直接用键名 */
function nodeId(it: CwItem): string {
  if (it.value?.kind === 'block') {
    const inner = scalarText(findEntry(it.value.items, 'id'))
    if (inner !== null) return inner
  }
  return it.key?.text ?? ''
}

/** 从根块构建节点列表（每次调用都重新读取，保证拿到最新状态） */
export function buildNodes(root: CwBlock): FocusNode[] {
  // 第一步：收集条目与坐标线索（x/y、continuous_focus_position、relative_position_id、offset）
  interface Raw {
    entry: CwItem
    id: string
    x: number | null
    y: number | null
    rel: string | null
    off: { x: number; y: number } | null
  }
  const raw: Raw[] = []
  for (const it of root.items) {
    if (it.deleted) continue
    if (it.kind !== 'entry' || !it.key || !it.value || it.value.kind !== 'block') continue
    if (META_KEYS.has(it.key.text)) continue
    const items = it.value.items
    let x = scalarText(findEntry(items, 'x'))
    let y = scalarText(findEntry(items, 'y'))
    // 持续型国策的位置写在 continuous_focus_position 里
    const cont = findEntry(items, 'continuous_focus_position')
    if ((x === null || y === null) && cont?.value?.kind === 'block') {
      if (x === null) x = scalarText(findEntry(cont.value.items, 'x'))
      if (y === null) y = scalarText(findEntry(cont.value.items, 'y'))
    }
    let off: { x: number; y: number } | null = null
    const offIt = findEntry(items, 'offset')
    if (offIt?.value?.kind === 'block') {
      const ox = scalarText(findEntry(offIt.value.items, 'x'))
      const oy = scalarText(findEntry(offIt.value.items, 'y'))
      if (ox !== null && oy !== null) off = { x: num(ox, 0), y: num(oy, 0) }
    }
    raw.push({
      entry: it,
      id: nodeId(it),
      x: x === null ? null : num(x, 0),
      y: y === null ? null : num(y, 0),
      rel: scalarText(findEntry(items, 'relative_position_id')),
      off
    })
  }

  // 第二步：解析坐标。显式 x/y 优先；其次 relative_position_id（默认在其下方一格，有 offset 则叠加）；
  // 仍无法解析的自动排到空闲格子，避免所有节点堆在原点叠成一片。
  // 注意缓存必须按国策 id 区分：真实文件的块键名全是 focus，键名相同不代表是同一个国策。
  const memo = new Map<string, { x: number; y: number }>()
  const used = new Set<string>()
  let maxX = 0
  for (const r of raw) if (r.x !== null) maxX = Math.max(maxX, r.x)
  const byId = (id: string): Raw | undefined => raw.find((r) => r.id === id)
  const resolve = (r: Raw, depth: number): { x: number; y: number } => {
    const hit = memo.get(r.id)
    if (hit) return hit
    let pos: { x: number; y: number } | null = null
    if (r.x !== null && r.y !== null) {
      pos = { x: r.x, y: r.y }
    } else if (depth < 60 && r.rel) {
      const parent = byId(r.rel)
      if (parent) {
        const base = resolve(parent, depth + 1)
        pos = r.off ? { x: base.x + r.off.x, y: base.y + r.off.y } : { x: base.x, y: base.y + 1 }
      }
    }
    if (!pos) {
      // 无法解析：从最右列再往右两格起找空闲格
      let ax = maxX + 2
      let ay = 0
      while (used.has(`${ax},${ay}`)) {
        ay++
        if (ay > 30) {
          ax++
          ay = 0
        }
      }
      pos = { x: ax, y: ay }
    }
    used.add(`${pos.x},${pos.y}`)
    memo.set(r.id, pos)
    return pos
  }

  const nodes: FocusNode[] = []
  for (const r of raw) {
    const it = r.entry
    const items = (it.value as CwBlock).items
    const pos = resolve(r, 0)
    const rel = r.rel
    const cap = scalarText(findEntry(items, 'available_if_capitulated')) === 'yes'
    nodes.push({
      id: r.id,
      entry: it,
      x: pos.x,
      y: pos.y,
      cost: num(scalarText(findEntry(items, 'cost')), 10),
      icon: scalarText(findEntry(items, 'icon')) ?? '',
      prerequisites: listOf(it, 'prerequisite'),
      mutuallyExclusive: listOf(it, 'mutually_exclusive'),
      relativePositionId: rel,
      availableIfCapitulated: cap,
      cancelIfInvalid: scalarText(findEntry(items, 'cancel_if_invalid')) === 'yes',
      searchFilters: listOf(it, 'search_filters'),
      hasAvailable: !!findEntry(items, 'available'),
      hasCompletionReward: !!findEntry(items, 'completion_reward'),
      hasBypass: !!findEntry(items, 'bypass'),
      hasCancel: !!findEntry(items, 'cancel_if_invalid')
    })
  }
  return nodes
}

/** 解析国策树文件；找不到根块时返回 null */
export function loadFocusTree(source: string): FocusTreeModel | null {
  const { file, errors } = parseFile(source, 'txt')
  if (!file) return null
  let root: CwBlock | null = null
  for (const it of file.items) {
    if (it.value?.kind === 'block') {
      root = it.value
      break
    }
  }
  if (!root) return null
  return { file, root, nodes: buildNodes(root), errors }
}

/** 由模型序列化出当前文件文本（只重写改动过的条目） */
export function saveFocusTree(model: FocusTreeModel): string {
  return serialize(model.file)
}

// ---------- 修改操作 ----------

/** 设置/删除条目的标量值；value 为 null 时删除该条目 */
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
  entry.value.items.push(makeScalarEntry(key, value))
  entry.dirty = true
}

/** 设置字符串列表（prerequisite / mutually_exclusive / search_filters）；空列表删除条目 */
export function setStringList(entry: CwItem, key: string, values: string[]): void {
  if (!entry.value || entry.value.kind !== 'block') return
  const it = findEntry(entry.value.items, key)
  if (values.length === 0) {
    if (it) it.deleted = true
    return
  }
  if (it) {
    if (!it.value || it.value.kind !== 'block') return
    it.value.items = values.map(makeBareItem)
    it.dirty = true
    it.deleted = false // 曾被删除的条目重新赋值时原地恢复
    return
  }
  entry.value.items.push(makeBlockEntry(key, values.map(makeBareItem)))
  entry.dirty = true
}

export function setFocusPos(entry: CwItem, x: number, y: number): void {
  setOrDeleteScalar(entry, 'x', String(Math.round(x)))
  setOrDeleteScalar(entry, 'y', String(Math.round(y)))
}

export function setFocusCost(entry: CwItem, cost: number): void {
  setOrDeleteScalar(entry, 'cost', String(Math.round(cost)))
}

export function setFocusIcon(entry: CwItem, icon: string): void {
  setOrDeleteScalar(entry, 'icon', icon.trim() === '' ? null : icon.trim())
}

export function setRelativePositionId(entry: CwItem, id: string | null): void {
  setOrDeleteScalar(entry, 'relative_position_id', id)
}

export function setAvailableIfCapitulated(entry: CwItem, on: boolean): void {
  setOrDeleteScalar(entry, 'available_if_capitulated', on ? 'yes' : null)
}

export function setCancelIfInvalid(entry: CwItem, on: boolean): void {
  setOrDeleteScalar(entry, 'cancel_if_invalid', on ? 'yes' : null)
}

/** 读取国策里的条件/效果块（available / completion_reward / bypass 等）；不存在时返回 null */
export function getFocusCondBlock(entry: CwItem, key: string): CondNode[] | null {
  return getCondBlockOf(entry, key)
}

/** 整体替换国策里的条件/效果块（结构化编辑保存，整块重写为规范多行） */
export function setFocusCondBlock(entry: CwItem, key: string, nodes: CondNode[]): void {
  setCondBlockOf(entry, key, nodes)
}

/** 完成效果里触发事件的引用（与事件编辑器联动） */
export interface FiredEventRef {
  /** 效果键：country_event / news_event / fire_events */
  effectKey: string
  /** 事件 id（命名空间.编号） */
  id: string
}

function eventIdOfNode(n: CondNode): string | null {
  const idChild = n.children.find((c) => c.key === 'id')
  const id = idChild?.args[0] ?? n.args[0]
  return id !== undefined && /^[A-Za-z0-9_]+\.\d+$/.test(id) ? id : null
}

/** 读取完成效果（completion_reward）里触发的事件：country_event/news_event 取 id 子块，fire_events 取裸 id 列表 */
export function getFocusFiredEvents(entry: CwItem): FiredEventRef[] {
  const nodes = getFocusCondBlock(entry, 'completion_reward') ?? []
  const out: FiredEventRef[] = []
  for (const n of nodes) {
    if (n.key === 'fire_events') {
      // fire_events = { FRA.2 FRA.3 } 的裸值解析为子节点（key 即事件 id）
      for (const a of [...n.args, ...n.children.map((c) => c.key)]) {
        if (/^[A-Za-z0-9_]+\.\d+$/.test(a)) out.push({ effectKey: 'fire_events', id: a })
      }
      continue
    }
    if (n.key === 'country_event' || n.key === 'news_event') {
      const id = eventIdOfNode(n)
      if (id) out.push({ effectKey: n.key, id })
    }
  }
  return out
}

/** 在完成效果里追加 country_event 触发（无 completion_reward 时自动创建空块） */
export function addFocusFiredEvent(entry: CwItem, eventId: string): void {
  const nodes = getFocusCondBlock(entry, 'completion_reward') ?? []
  const node: CondNode = { key: 'country_event', args: [], children: [{ key: 'id', args: [eventId], children: [] }] }
  setFocusCondBlock(entry, 'completion_reward', [...nodes, node])
}

/** 移除完成效果里触发某事件的条目（fire_events 只剔除该 id，删空后整条移除） */
export function removeFocusFiredEvent(entry: CwItem, eventId: string): void {
  const nodes = getFocusCondBlock(entry, 'completion_reward') ?? []
  const keep: CondNode[] = []
  for (const n of nodes) {
    if (n.key === 'fire_events') {
      const children = n.children.filter((c) => c.key !== eventId)
      const args = n.args.filter((a) => a !== eventId)
      if (children.length > 0 || args.length > 0) keep.push({ ...n, args, children })
      continue
    }
    if (n.key === 'country_event' || n.key === 'news_event') {
      if (eventIdOfNode(n) === eventId) continue
    }
    keep.push(n)
  }
  setFocusCondBlock(entry, 'completion_reward', keep)
}

/** 重命名国策 id：focus = { id = XXX } 改块内 id；旧式键名格式改键名 */
export function renameFocus(entry: CwItem, newId: string): void {
  if (entry.value?.kind === 'block' && findEntry(entry.value.items, 'id')) {
    setOrDeleteScalar(entry, 'id', newId)
    return
  }
  if (!entry.key) return
  entry.key.text = newId
  entry.key.end = newId.length
  entry.dirty = true
}

/** 新建国策并追加到树末尾（游戏标准格式）；返回其条目 */
export function addFocus(model: FocusTreeModel, id: string, x: number, y: number): CwItem {
  const entry = makeBlockEntry('focus', [
    makeScalarEntry('id', id),
    makeScalarEntry('x', String(Math.round(x))),
    makeScalarEntry('y', String(Math.round(y))),
    makeScalarEntry('cost', '10')
  ])
  model.root.items.push(entry)
  return entry
}

/** 删除国策，并清理其它节点对它的引用 */
export function deleteFocus(model: FocusTreeModel, id: string): void {
  const target = buildNodes(model.root).find((n) => n.id === id)
  if (target) target.entry.deleted = true
  // 用最新节点列表清理引用（model.nodes 是加载时的快照）
  for (const n of buildNodes(model.root)) {
    if (n.id === id) continue
    if (n.prerequisites.includes(id)) setStringList(n.entry, 'prerequisite', n.prerequisites.filter((p) => p !== id))
    if (n.mutuallyExclusive.includes(id)) {
      setStringList(n.entry, 'mutually_exclusive', n.mutuallyExclusive.filter((p) => p !== id))
    }
    if (n.relativePositionId === id) setRelativePositionId(n.entry, null)
  }
}

/** 在 target 的 prerequisite 中加入/移除 source（切换） */
export function togglePrerequisite(target: CwItem, sourceId: string): void {
  const current = listOf(target, 'prerequisite')
  const next = current.includes(sourceId) ? current.filter((p) => p !== sourceId) : [...current, sourceId]
  setStringList(target, 'prerequisite', next)
}

/** 判断目标国策文件中是否存在某 id 的国策 */
export function hasFocus(model: FocusTreeModel, id: string): boolean {
  return buildNodes(model.root).some((n) => n.id === id)
}

/** 生成一个未被占用的国策 id */
export function suggestFocusId(model: FocusTreeModel, base: string): string {
  let name = base
  let i = 0
  while (hasFocus(model, name)) {
    i++
    name = `${base}_${i}`
  }
  return name
}

// ---------- 快捷路径（shortcut，1.15+ 国策树翻页按钮） ----------

/** 快捷路径信息：index 为条目在根块 items 里的下标（shortcut 无 id 且键名重复，一律下标定位） */
export interface ShortcutInfo {
  entry: CwItem
  index: number
  /** 本地化键（按钮显示文字） */
  name: string | null
  /** 目标国策 id */
  target: string | null
  /** 滚轮缩放系数文本（原样保留，可选字段） */
  scrollWheelFactorText: string | null
  /** 是否带显示条件（trigger 块） */
  hasTrigger: boolean
}

/** 读取根块里的全部快捷路径（跳过已删除条目） */
export function getShortcuts(root: CwBlock): ShortcutInfo[] {
  const out: ShortcutInfo[] = []
  for (let i = 0; i < root.items.length; i++) {
    const it = root.items[i]
    if (it.deleted || it.kind !== 'entry' || !it.key || it.key.text !== 'shortcut') continue
    if (it.value?.kind !== 'block') continue
    const items = it.value.items
    out.push({
      entry: it,
      index: i,
      name: scalarText(findEntry(items, 'name')),
      target: scalarText(findEntry(items, 'target')),
      scrollWheelFactorText: scalarText(findEntry(items, 'scroll_wheel_factor')),
      hasTrigger: !!findEntry(items, 'trigger')
    })
  }
  return out
}

/** 新建快捷路径并追加到根块末尾；返回其条目 */
export function addShortcut(model: FocusTreeModel, name: string, target: string): CwItem {
  const entry = makeBlockEntry('shortcut', [makeScalarEntry('name', name, true), makeScalarEntry('target', target, true)])
  model.root.items.push(entry)
  return entry
}

/** 删除快捷路径（deleted 占位保留，无损） */
export function removeShortcut(root: CwBlock, index: number): void {
  const it = root.items[index]
  if (it && it.kind === 'entry' && it.key?.text === 'shortcut') it.deleted = true
}

/** 设置字符串字段（保留原引号风格：原带引号则带引号，原裸写则裸写）；不存在时新建带引号条目；null 删除该字段 */
function setStringOrDeleteScalar(entry: CwItem, key: string, value: string | null): void {
  if (!entry.value || entry.value.kind !== 'block') return
  const it = findEntry(entry.value.items, key)
  if (value === null) {
    if (it) it.deleted = true
    return
  }
  if (it) {
    if (!it.value || it.value.kind !== 'scalar') return
    setString(it, value)
    return
  }
  entry.value.items.push(makeScalarEntry(key, value, true))
  entry.dirty = true
}

/** 设置快捷路径的 name（本地化键）；null 删除该字段 */
export function setShortcutName(entry: CwItem, v: string | null): void {
  setStringOrDeleteScalar(entry, 'name', v)
}

/** 设置快捷路径的 target（目标国策 id）；null 删除该字段 */
export function setShortcutTarget(entry: CwItem, v: string | null): void {
  setStringOrDeleteScalar(entry, 'target', v)
}

/** 设置滚轮缩放系数；null 删除该字段 */
export function setShortcutScrollFactor(entry: CwItem, v: number | null): void {
  setOrDeleteScalar(entry, 'scroll_wheel_factor', v === null ? null : String(v))
}

/** 读取快捷路径的显示条件（trigger 块）；不存在时返回 null */
export function getShortcutTrigger(entry: CwItem): CondNode[] | null {
  return getCondBlockOf(entry, 'trigger')
}

/** 整体替换快捷路径的显示条件（空数组删除该块） */
export function setShortcutTrigger(entry: CwItem, nodes: CondNode[]): void {
  setCondBlockOf(entry, 'trigger', nodes)
}
