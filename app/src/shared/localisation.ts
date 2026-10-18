/**
 * 本地化文件模型（阶段① 第二块：本地化编辑器）
 *
 * 基于 clausewitz 无损 yml 解析：`l_simp_chinese:` 头 + `key:0 "文本"` 条目。
 * 只有编辑过的条目会被重写，其余内容（注释、空行、CRLF、BOM）逐字节保留。
 *
 * 国策名称联动：从国策树文本提取国策 id，检测本地化里缺失的 `id` / `id_desc` 键，
 * 一键补全（名称默认文本 = 键名占位，描述默认空，之后在编辑器里继续翻译）。
 */

import { parseFile, serialize, setString } from './clausewitz.ts'
import type { CwFile, CwItem, CwError } from './clausewitz.ts'
import { loadFocusTree } from './focusTree.ts'

export interface LocEntry {
  /** 键名（去掉 :0 版本后缀），如 FRA_land_reform */
  key: string
  /** 版本号（通常 0） */
  version: string
  /** 完整键，如 FRA_land_reform:0 */
  fullKey: string
  /** 文本（已去引号、反转义） */
  text: string
  /** 占位文本：文本与键名相同或为空（典型的未翻译状态） */
  placeholder: boolean
  /** 底层无损条目 */
  item: CwItem
}

export interface LocFile {
  file: CwFile
  entries: LocEntry[]
  /** 键 → 条目 */
  byKey: Map<string, LocEntry>
  errors: CwError[]
}

/** HOI4 语言头键（l_english 等），不当作可翻译条目 */
const LANG_KEYS = new Set([
  'l_english', 'l_simp_chinese', 'l_french', 'l_german', 'l_spanish',
  'l_polish', 'l_braz_por', 'l_russian', 'l_japanese', 'l_korean'
])

// 两种键格式都支持：香草 `key:0` 与用户文件常用的 `key:`（冒号后版本号可空）
const KEY_RE = /^([^:]+):(\d*)$/

/** 去掉引号并反转义（\" → "，\\ → \） */
export function unescapeYmlText(raw: string): string {
  let s = raw
  if (s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1)
  return s.replace(/\\"/g, '"').replace(/\\\\/g, '\\')
}

/** 转义文本（不包引号；引号由 setString 按原值形态补上） */
export function escapeYmlText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function loadLoc(source: string): LocFile | null {
  const { file, errors } = parseFile(source, 'yml')
  if (!file) return null
  const entries: LocEntry[] = []
  for (const item of file.items) {
    if (item.kind !== 'entry' || !item.key) continue
    const m = KEY_RE.exec(item.key.text)
    if (!m) continue
    if (!item.value || item.value.kind !== 'scalar') continue
    if (LANG_KEYS.has(m[1])) continue
    const key = m[1]
    const text = unescapeYmlText(item.value.token.text)
    entries.push({
      key,
      version: m[2],
      fullKey: item.key.text,
      text,
      placeholder: text === key || text.trim() === '',
      item
    })
  }
  const byKey = new Map<string, LocEntry>()
  for (const e of entries) byKey.set(e.key, e)
  return { file, entries, byKey, errors }
}

export function saveLoc(loc: LocFile): string {
  return serialize(loc.file)
}

/** 修改某键的文本；键不存在返回 false（整次调用 = 一步撤销的原子修改） */
export function setLocText(loc: LocFile, key: string, text: string): boolean {
  const e = loc.byKey.get(key)
  if (!e) return false
  setString(e.item, escapeYmlText(text))
  e.text = text
  e.placeholder = text === key || text.trim() === ''
  return true
}

/** 文件里主流键格式的版本后缀：多数键无版本号（key:）时沿用无版本号 */
function versionSuffix(loc: LocFile): string {
  if (loc.entries.length === 0) return ''
  const versionless = loc.entries.filter((e) => e.version === '').length
  return versionless * 2 >= loc.entries.length ? '' : '0'
}

/** 追加新键（已存在则忽略，返回是否追加）；键格式沿用文件主流惯例 */
export function addLocKey(loc: LocFile, key: string, text: string): boolean {
  if (loc.byKey.has(key)) return false
  const nl = loc.file.newline
  const fullKey = `${key}:${versionSuffix(loc)}`
  const val = escapeYmlText(text)
  const leading: CwItem['leading'] = []
  if (loc.file.items.length > 0) {
    leading.push({ kind: 'newline', text: nl, start: 0, end: nl.length })
  }
  leading.push({ kind: 'space', text: ' ', start: 0, end: 1 })
  const item: CwItem = {
    kind: 'entry',
    key: { kind: 'bare', text: fullKey, start: 0, end: fullKey.length },
    equals: null,
    value: { kind: 'scalar', token: { kind: 'string', text: `"${val}"`, start: 0, end: val.length + 2 } },
    leading,
    rawStart: 0,
    rawEnd: 0,
    trailing: [],
    dirty: true
  }
  loc.file.items.push(item)
  const e: LocEntry = {
    key,
    version: versionSuffix(loc),
    fullKey,
    text,
    placeholder: text === key || text.trim() === '',
    item
  }
  loc.entries.push(e)
  loc.byKey.set(key, e)
  return true
}

/** 删除某键（连同它整行）；键不存在返回 false */
export function deleteLocKey(loc: LocFile, key: string): boolean {
  const e = loc.byKey.get(key)
  if (!e) return false
  e.item.deleted = true
  loc.byKey.delete(key)
  const i = loc.entries.indexOf(e)
  if (i >= 0) loc.entries.splice(i, 1)
  return true
}

// ---------- 国策名称联动 ----------

/** 从国策树文本提取全部国策 id */
export function extractFocusIds(treeSource: string): string[] {
  const m = loadFocusTree(treeSource)
  return m ? m.nodes.map((n) => n.id) : []
}

export interface MissingFocusLoc {
  id: string
  missingName: boolean
  missingDesc: boolean
}

/** 检测国策名称 / 描述键的缺失情况 */
export function checkMissingFocusLoc(loc: LocFile, focusIds: string[]): MissingFocusLoc[] {
  const out: MissingFocusLoc[] = []
  for (const id of focusIds) {
    const missingName = !loc.byKey.has(id)
    const missingDesc = !loc.byKey.has(`${id}_desc`)
    if (missingName || missingDesc) out.push({ id, missingName, missingDesc })
  }
  return out
}

/** 一键补全：为缺失的键追加名称（文本 = 键名占位）与描述（空文本）条目，返回新增条数 */
export function fillMissingFocusLoc(loc: LocFile, focusIds: string[]): number {
  let added = 0
  for (const id of focusIds) {
    if (addLocKey(loc, id, id)) added++
    if (addLocKey(loc, `${id}_desc`, '')) added++
  }
  return added
}
