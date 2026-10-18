/**
 * HOI4 Clausewitz 脚本无损解析器
 *
 * 设计目标（钢铁工坊硬性要求之一）：无损编辑。
 * - 解析时不丢弃任何内容：注释、空行、空格、CRLF、BOM 全部保留为原始文本片段
 * - 未修改的条目序列化时按原字节原样输出；只有被标记 dirty 的条目才重新生成
 * - 因此"只重写改过的条目，没碰过的地方一个字符都不动"
 *
 * 支持两种文件：
 * - .txt（common/、events/ 等）：`key = value`、`key = { ... }`、块内裸值列表
 * - .yml（localisation/）：`l_english:` 头 + `key:0 "text"` 条目
 */

export type TokenKind =
  | 'comment' // # 到行尾（不含换行）
  | 'string' // "..." 含引号
  | 'bare' // 标识符/数字/日期/键名（可含 : 等字符）
  | 'equals' // =
  | 'open' // {
  | 'close' // }
  | 'space' // 空格/制表符连续段
  | 'newline' // \n 或 \r\n（原样保留）

export interface Token {
  kind: TokenKind
  text: string
  start: number
  end: number
}

export function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  const n = source.length
  while (i < n) {
    const c = source[i]
    if (c === '#') {
      const start = i
      while (i < n && source[i] !== '\n' && source[i] !== '\r') i++
      tokens.push({ kind: 'comment', text: source.slice(start, i), start, end: i })
    } else if (c === '"') {
      const start = i
      i++
      // 字符串内的 \" 与 \\ 是转义（本编辑器写入本地化文本时使用），跳过它们继续扫描
      while (i < n && source[i] !== '"') {
        if (source[i] === '\\' && (source[i + 1] === '"' || source[i + 1] === '\\')) i += 2
        else i++
      }
      if (i < n) i++ // 收尾引号
      tokens.push({ kind: 'string', text: source.slice(start, i), start, end: i })
    } else if (c === '=') {
      tokens.push({ kind: 'equals', text: '=', start: i, end: i + 1 })
      i++
    } else if (c === '{') {
      tokens.push({ kind: 'open', text: '{', start: i, end: i + 1 })
      i++
    } else if (c === '}') {
      tokens.push({ kind: 'close', text: '}', start: i, end: i + 1 })
      i++
    } else if (c === '\n' || c === '\r') {
      const start = i
      if (c === '\r' && source[i + 1] === '\n') i += 2
      else i++
      tokens.push({ kind: 'newline', text: source.slice(start, i), start, end: i })
    } else if (c === ' ' || c === '\t') {
      const start = i
      while (i < n && (source[i] === ' ' || source[i] === '\t')) i++
      tokens.push({ kind: 'space', text: source.slice(start, i), start, end: i })
    } else {
      const start = i
      while (i < n && !' \t\n\r=#{}"'.includes(source[i])) i++
      if (i === start) i++ // 防御：遇到意外字符时前进一格
      tokens.push({ kind: 'bare', text: source.slice(start, i), start, end: i })
    }
  }
  return tokens
}

// ---------- 数据模型 ----------

export interface CwScalar {
  kind: 'scalar'
  token: Token
}

export interface CwBlock {
  kind: 'block'
  items: CwItem[]
  openToken: Token
  closeToken: Token | null
  /** 最后一个子条目与 `}` 之间的琐碎内容（原样保留） */
  preClose: Token[]
}

export type CwValue = CwScalar | CwBlock

export interface CwItem {
  kind: 'entry' | 'bare-item'
  /** 条目键名（yml 里是形如 `key:0` 的键；bare-item 为 null） */
  key: Token | null
  /** `=` 令牌；yml 头（如 `l_english:`）为 null */
  equals: Token | null
  /** 值；yml 头可能为 null */
  value: CwValue | null
  /** 本条目之前的琐碎内容：注释、空行、缩进（原样保留） */
  leading: Token[]
  /** 条目内容起点（不含 leading），用于未修改时按原文本切片 */
  rawStart: number
  /** 条目内容终点（值的末尾或 `}` 的末尾，不含行尾注释） */
  rawEnd: number
  /** 值之后的同行内容：空格 + 行尾注释（原样保留） */
  trailing: Token[]
  /** 修改标记：true 时序列化会重新生成该条目 */
  dirty: boolean
  /** 删除标记：true 时序列化会跳过该条目（连同它的 leading 注释/缩进） */
  deleted?: boolean
}

export interface CwFile {
  kind: 'txt' | 'yml'
  source: string
  /** BOM（'' 或 '﻿'） */
  bom: string
  items: CwItem[]
  /** 最后一个条目之后的剩余内容（原样保留） */
  trailing: Token[]
  newline: '\n' | '\r\n'
}

export interface CwError {
  message: string
  offset: number
  line: number
  col: number
}

export interface ParseResult {
  file: CwFile | null
  errors: CwError[]
}

// ---------- 解析 ----------

export function lineCol(source: string, offset: number): { line: number; col: number } {
  let line = 1
  let col = 1
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === '\n') {
      line++
      col = 1
    } else {
      col++
    }
  }
  return { line, col }
}

interface ListParseResult {
  items: CwItem[]
  next: number // close 令牌的索引
  preClose: Token[]
}

function parseList(
  tokens: Token[],
  idx: number,
  stopAtClose: boolean,
  errors: CwError[],
  source: string,
  kind: 'txt' | 'yml'
): ListParseResult {
  const items: CwItem[] = []
  let leading: Token[] = []

  const err = (message: string, offset: number): void => {
    const lc = lineCol(source, offset)
    errors.push({ message, offset, line: lc.line, col: lc.col })
  }

  // 收集值之后的同行空格与注释
  const captureTrailing = (from: number): { trailing: Token[]; next: number } => {
    const trailing: Token[] = []
    let j = from
    while (j < tokens.length && tokens[j].kind === 'space') {
      trailing.push(tokens[j])
      j++
    }
    if (j < tokens.length && tokens[j].kind === 'comment') {
      trailing.push(tokens[j])
      j++
    }
    return { trailing, next: j }
  }

  while (idx < tokens.length) {
    const t = tokens[idx]
    if (t.kind === 'comment' || t.kind === 'newline' || t.kind === 'space') {
      leading.push(t)
      idx++
      continue
    }
    if (t.kind === 'close') {
      if (!stopAtClose) err('多余的 `}`', t.start)
      return { items, next: idx, preClose: leading }
    }
    if (t.kind === 'open') {
      err('多余的 `{`', t.start)
      leading.push(t)
      idx++
      continue
    }
    if (t.kind === 'equals') {
      err('多余的 `=`', t.start)
      leading.push(t)
      idx++
      continue
    }
    if (t.kind === 'string') {
      // 孤立的字符串值（罕见的块内裸值）
      const { trailing, next } = captureTrailing(idx + 1)
      items.push({
        kind: 'bare-item',
        key: null,
        equals: null,
        value: { kind: 'scalar', token: t },
        leading,
        rawStart: t.start,
        rawEnd: t.end,
        trailing,
        dirty: false
      })
      leading = []
      idx = next
      continue
    }
    // t.kind === 'bare'：可能的条目起点
    const key = t
    let j = idx + 1
    const between: Token[] = []
    while (j < tokens.length && tokens[j].kind === 'space') {
      between.push(tokens[j])
      j++
    }
    const eq = tokens[j]

    if (eq && eq.kind === 'equals') {
      // 等号之后找值
      let k = j + 1
      while (k < tokens.length && tokens[k].kind === 'space') k++
      const vt = tokens[k]
      if (!vt || vt.kind === 'comment' || vt.kind === 'newline' || vt.kind === 'close' || vt.kind === 'equals') {
        err(`键 "${key.text}" 的 \`=\` 后面缺少值`, key.end)
        // 恢复：把键当作裸值条目
        const { trailing, next } = captureTrailing(idx + 1)
        items.push({
          kind: 'bare-item',
          key: null,
          equals: null,
          value: { kind: 'scalar', token: key },
          leading,
          rawStart: key.start,
          rawEnd: key.end,
          trailing,
          dirty: false
        })
        leading = []
        idx = next
        continue
      }
      if (vt.kind === 'open') {
        const sub = parseList(tokens, k + 1, true, errors, source, kind)
        if (sub.next >= tokens.length) {
          err(`键 "${key.text}" 的块缺少结尾的 \`}\``, key.start)
          const block: CwBlock = {
            kind: 'block',
            items: sub.items,
            openToken: vt,
            closeToken: null,
            preClose: sub.preClose
          }
          items.push({
            kind: 'entry',
            key,
            equals: eq,
            value: block,
            leading,
            rawStart: key.start,
            rawEnd: source.length,
            trailing: [],
            dirty: false
          })
          leading = []
          idx = tokens.length
          continue
        }
        const closeTok = tokens[sub.next]
        const block: CwBlock = {
          kind: 'block',
          items: sub.items,
          openToken: vt,
          closeToken: closeTok,
          preClose: sub.preClose
        }
        const { trailing, next } = captureTrailing(sub.next + 1)
        items.push({
          kind: 'entry',
          key,
          equals: eq,
          value: block,
          leading,
          rawStart: key.start,
          rawEnd: closeTok.end,
          trailing,
          dirty: false
        })
        leading = []
        idx = next
        continue
      }
      if (vt.kind === 'string' || vt.kind === 'bare') {
        const { trailing, next } = captureTrailing(k + 1)
        items.push({
          kind: 'entry',
          key,
          equals: eq,
          value: { kind: 'scalar', token: vt },
          leading,
          rawStart: key.start,
          rawEnd: vt.end,
          trailing,
          dirty: false
        })
        leading = []
        idx = next
        continue
      }
      // 其余情况：按裸值恢复
      err(`键 "${key.text}" 的值类型无法识别`, k)
      const { trailing, next } = captureTrailing(idx + 1)
      items.push({
        kind: 'bare-item',
        key: null,
        equals: null,
        value: { kind: 'scalar', token: key },
        leading,
        rawStart: key.start,
        rawEnd: key.end,
        trailing,
        dirty: false
      })
      leading = []
      idx = next
      continue
    }

    // 没有等号：块内裸值 / yml 条目 / yml 头
    if (kind === 'yml') {
      const vt = tokens[j]
      if (vt && vt.kind === 'string') {
        const { trailing, next } = captureTrailing(j + 1)
        items.push({
          kind: 'entry',
          key,
          equals: null,
          value: { kind: 'scalar', token: vt },
          leading,
          rawStart: key.start,
          rawEnd: vt.end,
          trailing,
          dirty: false
        })
        leading = []
        idx = next
        continue
      }
      if (vt && vt.kind === 'bare') {
        // yml 头可能带裸值（少见，如 l_english:0）
        const { trailing, next } = captureTrailing(j + 1)
        items.push({
          kind: 'entry',
          key,
          equals: null,
          value: { kind: 'scalar', token: vt },
          leading,
          rawStart: key.start,
          rawEnd: vt.end,
          trailing,
          dirty: false
        })
        leading = []
        idx = next
        continue
      }
      // yml 头：只有键（如 l_english:）
      const { trailing, next } = captureTrailing(j)
      items.push({
        kind: 'entry',
        key,
        equals: null,
        value: null,
        leading,
        rawStart: key.start,
        rawEnd: key.end,
        trailing,
        dirty: false
      })
      leading = [...between]
      idx = next
      continue
    }

    // txt：块内裸值（如 prerequisite = { focus_a focus_b }）
    // 注意：键与下一个令牌之间的空格属于下一个条目的 leading，必须保留
    {
      const { trailing, next } = captureTrailing(j)
      items.push({
        kind: 'bare-item',
        key: null,
        equals: null,
        value: { kind: 'scalar', token: key },
        leading,
        rawStart: key.start,
        rawEnd: key.end,
        trailing,
        dirty: false
      })
      leading = [...between]
      idx = next
    }
  }

  return { items, next: idx, preClose: leading }
}

export function parseFile(source: string, kind: 'txt' | 'yml'): ParseResult {
  const errors: CwError[] = []
  let bom = ''
  let body = source
  if (body.startsWith('﻿')) {
    bom = '﻿'
    body = body.slice(1)
  }
  const tokens = tokenize(body)
  const firstNl = tokens.find((t) => t.kind === 'newline')
  const newline: '\n' | '\r\n' = firstNl && firstNl.text === '\r\n' ? '\r\n' : '\n'
  const list = parseList(tokens, 0, false, errors, body, kind)
  const file: CwFile = {
    kind,
    source: body,
    bom,
    items: list.items,
    trailing: list.preClose,
    newline
  }
  return { file, errors }
}

// ---------- 序列化 ----------

/** 判断条目（或其块后代）是否需要重新渲染 */
function needsRender(item: CwItem): boolean {
  if (item.deleted) return false
  if (item.dirty) return true
  return item.value?.kind === 'block' && item.value.items.some((c) => c.deleted || needsRender(c))
}

function renderItems(
  items: CwItem[],
  depth: number,
  file: CwFile,
  afterFirst: Token[] | null
): { text: string; headTail: Token[] } {
  const nl = file.newline
  let out = ''
  // 首个未删除子条目 leading 里、首个换行之前的 token（解析时 `{` 后的同行空格/注释
  // 挂在首个子条目 leading 上）属于父块头部行，交回 renderItem 写入头部；
  // 文件顶层（depth 0）没有父块头，不偷取
  let headTail: Token[] = []
  // 第一个未删除条目的下标（首子条目换行跳过逻辑按它判断）
  let firstIdx = -1
  for (let k = 0; k < items.length; k++) {
    if (!items[k].deleted) {
      firstIdx = k
      break
    }
  }
  let lastIdx = -1
  for (let k = items.length - 1; k >= 0; k--) {
    if (!items[k].deleted) {
      lastIdx = k
      break
    }
  }
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (item.deleted) continue // 删除的条目连同其 leading 一起跳过
    // 同行裸值续写：比较式触发器（has_stability > 0.5）在解析器里是连续裸值，
    // 重渲染时保持在同一行（缩进只加在第一个裸值上）
    if (item.kind === 'bare-item' && !item.leading.some((t) => t.kind === 'newline')) {
      const tok = item.value && item.value.kind === 'scalar' ? item.value.token : null
      out += ' ' + (tok ? tok.text : '')
      continue
    }
    const rendered = needsRender(item)
    let leadingTokens = item.leading
    // 首个子条目：leading 里首个换行之前的 token（`{` 后的同行空格/注释）挪回父块头部行
    if (depth > 0 && i === firstIdx) {
      const nlIdx = leadingTokens.findIndex((t) => t.kind === 'newline')
      if (nlIdx > 0) {
        headTail = leadingTokens.slice(0, nlIdx)
        leadingTokens = leadingTokens.slice(nlIdx)
      } else if (nlIdx < 0) {
        headTail = leadingTokens
        leadingTokens = []
      }
    }
    // 父级脏块重渲染时，首个子条目的 leading 开头的换行由父级提供，跳过
    if (depth > 0 && i === firstIdx && leadingTokens.length > 0 && leadingTokens[0].kind === 'newline') {
      leadingTokens = leadingTokens.slice(1)
    }
    // 重新渲染的子条目：leading 末尾的原始缩进交给 renderItem 作为新缩进——
    // 含空格的缩进 = 文件自身的缩进风格，原地保留（空格缩进的文件不会被重写成制表符）；
    // 纯制表符缩进 = 规范化重建的子树（condBlockText 等），按新深度/同层兄弟重新缩进
    let indentOverride: string | null = null
    if (depth > 0 && rendered) {
      let cut = leadingTokens.length
      while (cut > 0 && leadingTokens[cut - 1].kind === 'space') cut--
      if (cut < leadingTokens.length) {
        const own = leadingTokens.slice(cut).map((t) => t.text).join('')
        leadingTokens = leadingTokens.slice(0, cut)
        if (!/^\t+$/.test(own)) indentOverride = own
      }
      if (indentOverride === null) {
        // 新条目或规范化重建：沿用同层上一个未删除条目的缩进（仅限文件自身的空格风格）
        for (let j = i - 1; j >= 0; j--) {
          const sib = items[j]
          if (sib.deleted) continue
          let si = sib.leading.length
          while (si > 0 && sib.leading[si - 1].kind === 'space') si--
          if (si < sib.leading.length) {
            const sibInd = sib.leading.slice(si).map((t) => t.text).join('')
            if (!/^\t+$/.test(sibInd)) indentOverride = sibInd
          }
          break
        }
      }
    }
    out += leadingTokens.map((t) => t.text).join('')
    out += renderItem(item, depth, file, indentOverride)
    if (rendered && item.value?.kind === 'block') {
      // 脏块头部行已消费 `{` 后的行尾注释，trailing 只输出首个换行起的部分
      const firstNl = item.trailing.findIndex((t) => t.kind === 'newline')
      if (firstNl >= 0) out += item.trailing.slice(firstNl).map((t) => t.text).join('')
    } else {
      out += item.trailing.map((t) => t.text).join('')
    }
    if (rendered) {
      let nextFirst: Token | undefined
      let nextIdx = i + 1
      while (nextIdx < items.length && items[nextIdx].deleted) nextIdx++
      if (nextIdx < items.length && items[nextIdx].leading.length > 0) nextFirst = items[nextIdx].leading[0]
      else if (i === lastIdx && afterFirst && afterFirst.length > 0) nextFirst = afterFirst[0]
      // 下一个条目是同行裸值续写（比较式触发器）时不补换行
      const nextItem = nextIdx < items.length ? items[nextIdx] : null
      const sameLineBare =
        nextItem !== null && nextItem.kind === 'bare-item' && !nextItem.leading.some((t) => t.kind === 'newline')
      if (!sameLineBare && !(nextFirst && nextFirst.kind === 'newline')) out += nl
    }
  }
  return { text: out, headTail }
}

function renderItem(item: CwItem, depth: number, file: CwFile, indentOverride: string | null): string {
  const indent = indentOverride ?? '\t'.repeat(depth)
  if (!needsRender(item)) {
    return file.source.slice(item.rawStart, item.rawEnd)
  }
  if (item.kind === 'bare-item' || !item.key) {
    const tok = item.value && item.value.kind === 'scalar' ? item.value.token : null
    return indent + (tok ? tok.text : '')
  }
  const v = item.value
  if (v === null) {
    return indent + item.key.text // yml 头
  }
  if (v.kind === 'scalar') {
    return indent + item.key.text + (item.equals ? ' = ' : ' ') + v.token.text
  }
  // 块
  // 纯裸值列表（如 mutually_exclusive = { A B }）按原版习惯渲染为单行；
  // 只看未删除的子项（删除后还按已删项判断会把块错判成单行/漏渲染）
  const live = v.items.filter((c) => !c.deleted)
  const allBare =
    live.length > 0 &&
    live.every((c) => c.kind === 'bare-item') &&
    live.every((c) => !c.leading.some((t) => t.kind === 'comment' || t.kind === 'newline')) &&
    live.every((c) => !c.trailing.some((t) => t.kind === 'comment' || t.kind === 'newline')) &&
    !v.preClose.some((t) => t.kind === 'comment' || t.kind === 'newline')
  if (allBare) {
    let s2 = indent + item.key.text + ' = {'
    for (const c of live) {
      const tok = c.value && c.value.kind === 'scalar' ? c.value.token : null
      s2 += ' ' + (tok ? tok.text : '')
    }
    // 头部行尾注释保持在 `}` 之后（调用方已跳过这部分 trailing）
    const fnl = item.trailing.findIndex((t) => t.kind === 'newline')
    if (fnl !== 0) s2 += (fnl < 0 ? item.trailing : item.trailing.slice(0, fnl)).map((t) => t.text).join('')
    return s2 + ' }'
  }
  const inner = renderItems(v.items, depth + 1, file, v.preClose)
  // `{` 后的同行空格/注释解析时挂在首个子条目的 leading 上，这里挪回头部行
  let s = indent + item.key.text + ' = {' + inner.headTail.map((t) => t.text).join('')
  s += file.newline
  s += inner.text
  // preClose 只保留到最后一个换行为止，`}` 前的缩进由渲染器按新深度重新生成
  let lastNl = -1
  v.preClose.forEach((t, idx) => {
    if (t.kind === 'newline') lastNl = idx
  })
  s += v.preClose
    .slice(0, lastNl + 1)
    .map((t) => t.text)
    .join('')
  s += indent + '}'
  // `}` 后的同行空格/注释保持在闭合行；其余 trailing 由调用方输出
  const firstNlIdx = item.trailing.findIndex((t) => t.kind === 'newline')
  if (firstNlIdx !== 0) s += (firstNlIdx < 0 ? item.trailing : item.trailing.slice(0, firstNlIdx)).map((t) => t.text).join('')
  return s
}

export function serialize(file: CwFile): string {
  let out = file.bom
  out += renderItems(file.items, 0, file, file.trailing).text
  out += file.trailing.map((t) => t.text).join('')
  return out
}

// ---------- 常用辅助 ----------

/** 在一组条目中查找第一个键名匹配的条目（不含裸值；已删除的条目视为不存在） */
export function findEntry(items: CwItem[], key: string): CwItem | null {
  return items.find((it) => it.kind === 'entry' && !it.deleted && it.key !== null && it.key.text === key) ?? null
}

/** 查找全部键名匹配的条目（不含裸值；已删除的条目视为不存在） */
export function findAllEntries(items: CwItem[], key: string): CwItem[] {
  return items.filter((it) => it.kind === 'entry' && !it.deleted && it.key !== null && it.key.text === key)
}

/** 查找键名匹配但已被删除的条目（重新赋值时原地恢复，保持行序不变） */
export function findDeletedEntry(items: CwItem[], key: string): CwItem | null {
  return items.find((it) => it.deleted && it.kind === 'entry' && it.key !== null && it.key.text === key) ?? null
}

/** 将条目的标量值替换为新文本并标记为已修改（字符串值自动加引号） */
export function setString(item: CwItem, text: string): void {
  if (!item.value || item.value.kind !== 'scalar') return
  const tok = item.value.token
  const wasQuoted = tok.text.startsWith('"') && tok.text.endsWith('"')
  tok.text = wasQuoted ? `"${text}"` : text
  tok.end = tok.text.length
  item.dirty = true
}

/** 新建标量条目（用于插入新内容） */
export function makeScalarEntry(key: string, value: string, quoted = false): CwItem {
  const text = quoted ? `"${value}"` : value
  return {
    kind: 'entry',
    key: { kind: 'bare', text: key, start: 0, end: key.length },
    equals: { kind: 'equals', text: '=', start: 0, end: 1 },
    value: { kind: 'scalar', token: { kind: 'bare', text, start: 0, end: text.length } },
    leading: [],
    rawStart: 0,
    rawEnd: 0,
    trailing: [],
    dirty: true
  }
}

/** 新建裸值条目（用于块内值列表） */
export function makeBareItem(text: string): CwItem {
  return {
    kind: 'bare-item',
    key: null,
    equals: null,
    value: { kind: 'scalar', token: { kind: 'bare', text, start: 0, end: text.length } },
    leading: [],
    rawStart: 0,
    rawEnd: 0,
    trailing: [],
    dirty: true
  }
}

/** 从条目块内同层条目的 leading 里推断换行符（默认 '\n'）——追加新条目时用它补 leading 换行 */
export function newlineOfBlock(entry: CwItem): string {
  if (!entry.value || entry.value.kind !== 'block') return '\n'
  for (const sib of entry.value.items) {
    if (sib.deleted) continue
    const t = sib.leading.find((x) => x.kind === 'newline')
    if (t) return t.text
  }
  return '\n'
}

/** 新建块条目（用于插入新内容） */
export function makeBlockEntry(key: string, children: CwItem[] = []): CwItem {
  return {
    kind: 'entry',
    key: { kind: 'bare', text: key, start: 0, end: key.length },
    equals: { kind: 'equals', text: '=', start: 0, end: 1 },
    value: {
      kind: 'block',
      items: children,
      openToken: { kind: 'open', text: '{', start: 0, end: 1 },
      closeToken: { kind: 'close', text: '}', start: 0, end: 1 },
      preClose: []
    },
    leading: [],
    rawStart: 0,
    rawEnd: 0,
    trailing: [],
    dirty: true
  }
}

/** 提取条目的标量文本（字符串返回不含引号的内容） */
export function scalarText(item: CwItem | null): string | null {
  if (!item || !item.value || item.value.kind !== 'scalar') return null
  const text = item.value.token.text
  if (text.startsWith('"') && text.endsWith('"')) return text.slice(1, -1)
  return text
}

/** 新建一个标量令牌（用于编辑时替换值） */
export function makeScalarToken(text: string): Token {
  return { kind: 'bare', text, start: 0, end: text.length }
}

/** 将条目的标量值替换为新文本并标记为已修改 */
export function setScalar(item: CwItem, text: string): void {
  if (!item.value || item.value.kind !== 'scalar') return
  item.value.token.text = text
  item.value.token.end = text.length
  item.dirty = true
}

/** 统计文件中的条目数（含嵌套） */
export function countEntries(items: CwItem[]): number {
  let n = 0
  for (const it of items) {
    n++
    if (it.value && it.value.kind === 'block') n += countEntries(it.value.items)
  }
  return n
}
