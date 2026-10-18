import { useEffect, useMemo, useRef, useState } from 'react'
import { COND_CATALOG, CAT_ZH, condSpec, condBlockText, isCondOperator, suggestCondKeys } from '../../../shared/conditions'
import type { CondNode, CondParam, CondSpec } from '../../../shared/conditions'
import { hasCjk } from '../../../shared/cjk'
import RefTable from './RefTable'
import type { RefRow } from './RefTable'

/**
 * 结构化条件/效果编辑器（硬性要求 #2）
 * 以目录（中文说明 + 参数规格）驱动：有规格的键显示结构化参数表单，
 * 无规格的键保持自由文本，比较式触发器（has_stability > 0.5）有运算符选择。
 * 编辑在本地副本上进行，「确定」才写回模型（一步撤销）。
 */

export const COND_BLOCK_META: Record<string, { zh: string; desc: string }> = {
  available: { zh: '可用条件', desc: '满足这些条件时，这个国策才能被点击（触发条件）' },
  completion_reward: { zh: '完成效果', desc: '国策完成时执行的效果' },
  bypass: { zh: '跳过条件', desc: '满足时直接完成国策，无需等待（触发条件）' },
  trigger: { zh: '触发条件', desc: '满足这些条件、且平均触发时间到达时事件弹出（触发条件）' },
  mean_time_to_happen: { zh: '平均触发时间（MTTH）', desc: 'days = 平均天数；modifier = { factor = 修正 } 按条件调整触发概率' },
  immediate: { zh: '立即效果', desc: '事件弹出时立即执行（在玩家看到弹窗之前生效）' },
  option_trigger: { zh: '选项显示条件', desc: '满足条件时该选项才会显示（触发条件）' },
  ai_chance: { zh: 'AI 选择权重', desc: 'base = 基础权重；modifier = { factor = 修正 } 按条件调整' },
  option_effects: { zh: '选项效果', desc: '玩家选择该选项后执行的效果' },
  // 决议（第二期决议编辑器）
  visible: { zh: '显示条件', desc: '满足条件时该决议才出现在决议列表里（触发条件）' },
  allowed: { zh: '允许条件', desc: '满足条件时该决议才能被执行（触发条件）' },
  complete_effect: { zh: '完成效果', desc: '执行决议后生效的效果' },
  remove_effect: { zh: '移除效果', desc: '决议被移除或到期时执行的效果' },
  ai_will_do: { zh: 'AI 执行意愿', desc: 'base = 基础权重；modifier = { factor = 修正 } 按条件调整 AI 执行概率' },
  modifier: { zh: '静态修正', desc: '决议在列表中时持续生效的国家修正' },
  targeted_modifier: { zh: '目标修正', desc: '对目标州/国家生效的修正' },
  // 民族精神（第三期民族精神编辑器）
  on_add: { zh: '添加时效果', desc: '这个民族精神被添加时执行的效果' },
  on_remove: { zh: '移除时效果', desc: '这个民族精神被移除时执行的效果' }
}

const KIND_ZH: Record<CondSpec['kind'], string> = { effect: '效果', trigger: '条件', logic: '逻辑' }

const OPS = ['=', '>', '<', '>=', '<=']

// ---------- 对照表数据 ----------

const REF_ROWS: RefRow[] = COND_CATALOG.map((s) => ({
  key: s.key,
  zh: s.zh,
  cat: CAT_ZH[s.cat],
  badge: KIND_ZH[s.kind],
  badgeClass: s.kind,
  scope: s.scope
}))

// id 用本地化分类名（与 REF_ROWS 的 cat 字段同源，页签过滤才能命中）
const REF_CATS: { id: string; zh: string }[] = (Object.entries(CAT_ZH) as [string, string][]).map(([, zh]) => ({
  id: zh,
  zh
}))

// ---------- 不可变树操作 ----------

function cloneNode(n: CondNode): CondNode {
  return { key: n.key, args: [...n.args], children: n.children.map(cloneNode) }
}

function updateAt(list: CondNode[], path: number[], fn: (n: CondNode) => CondNode): CondNode[] {
  const [head, ...rest] = path
  return list.map((n, i) => {
    if (i !== head) return n
    if (rest.length === 0) return fn(cloneNode(n))
    return { ...cloneNode(n), children: updateAt(n.children, rest, fn) }
  })
}

function removeAt(list: CondNode[], path: number[]): CondNode[] {
  const [head, ...rest] = path
  return list
    .map((n, i) => {
      if (i !== head) return n
      if (rest.length === 0) return null
      return { ...cloneNode(n), children: removeAt(n.children, rest) }
    })
    .filter((n): n is CondNode => n !== null)
}

function addChildAt(list: CondNode[], path: number[], node: CondNode): CondNode[] {
  if (path.length === 0) return [...list, node]
  const [head, ...rest] = path
  return list.map((n, i) => {
    if (i !== head) return n
    return { ...cloneNode(n), children: addChildAt(n.children, rest, node) }
  })
}

// ---------- 参数切片 ----------

/** 把某个参数改成新切片（number 参数形如 ['>', '50']，其它 ['值']；[] 表示清空） */
function setParamSlice(node: CondNode, spec: CondSpec, editedIdx: number, newSlice: string[]): string[] {
  const scalarParams = spec.params?.filter((p) => !p.block) ?? []
  const slices: string[][] = []
  let cursor = 0
  for (const p of scalarParams) {
    if (p.kind === 'number') {
      const a0 = node.args[cursor]
      if (a0 !== undefined && isCondOperator(a0)) {
        slices.push(node.args.slice(cursor, cursor + 2))
        cursor += 2
      } else {
        slices.push(a0 !== undefined ? [a0] : [])
        cursor += 1
      }
    } else {
      const a = node.args[cursor]
      slices.push(a !== undefined ? [a] : [])
      cursor += 1
    }
  }
  slices[editedIdx] = newSlice
  const extras = node.args.slice(cursor) // 规格之外的多余参数原样保留
  return [...slices.flat(), ...extras]
}

// ---------- 自动补全 ----------

function KeyInput({
  value,
  onPick,
  onType,
  placeholder
}: {
  value: string
  onPick: (key: string) => void
  onType: (key: string) => void
  placeholder?: string
}): React.JSX.Element {
  const [text, setText] = useState(value)
  const [open, setOpen] = useState(false)
  const [sel, setSel] = useState(0)
  const boxRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setText(value)
  }, [value])

  const matches = useMemo(() => suggestCondKeys(text, 30), [text])
  // 中文/全角只作查询，不作键名：有 CJK 且无匹配时拦截提交并给出提示
  const cjk = hasCjk(text)
  const blocked = cjk && text.trim() !== '' && matches.length === 0

  useEffect(() => {
    setSel(0)
  }, [matches.length])

  const pick = (key: string): void => {
    setText(key)
    setOpen(false)
    onPick(key)
  }

  return (
    <div className="cond-key-box" ref={boxRef}>
      <input
        className="text-input cond-key"
        value={text}
        placeholder={placeholder ?? '输入条件名…'}
        onChange={(e) => {
          setText(e.target.value)
          setOpen(true)
          // 中文只作查询：含 CJK 的击键不实时写回键名（防止打一半污染模型）
          if (!hasCjk(e.target.value)) onType(e.target.value)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setTimeout(() => setOpen(false), 150)
          // 失焦丢弃中文查询，回显模型值（防止中文被提交成键名）
          if (hasCjk(text) && text !== value) setText(value)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && open) {
            e.preventDefault()
            setSel((s) => Math.min(matches.length - 1, s + 1))
          } else if (e.key === 'ArrowUp' && open) {
            e.preventDefault()
            setSel((s) => Math.max(0, s - 1))
          } else if (e.key === 'Enter' && open) {
            e.preventDefault()
            if (matches[sel]) pick(matches[sel].key)
            else if (text.trim() && !cjk) pick(text.trim())
          } else if (e.key === 'Escape') {
            setOpen(false)
          }
        }}
      />
      {open && (matches.length > 0 || blocked) && (
        <div className="cond-drop">
          {matches.map((s, i) => (
            <div
              key={s.key}
              className={i === sel ? 'cond-drop-item sel' : 'cond-drop-item'}
              onMouseDown={(e) => {
                e.preventDefault()
                pick(s.key)
              }}
              onMouseEnter={() => setSel(i)}
            >
              <span className="cond-drop-key">{s.key}</span>
              <span className={`cond-kind-badge ${s.kind}`}>{KIND_ZH[s.kind]}</span>
              <span className="cond-drop-zh">{s.zh}</span>
              <span className="cond-drop-cat">{CAT_ZH[s.cat]}</span>
            </div>
          ))}
          {blocked && (
            <div className="drop-note">没有匹配的代码；中文只用于搜索，不会被写成键名——请换关键词，或点右上角「📖 对照表」浏览</div>
          )}
        </div>
      )}
    </div>
  )
}

// ---------- 参数控件 ----------

function ParamField({
  param,
  slice,
  onChange
}: {
  param: CondParam
  slice: string[]
  onChange: (slice: string[]) => void
}): React.JSX.Element {
  if (param.kind === 'bool') {
    const v = slice[0] ?? ''
    return (
      <select className="cond-select" value={v} onChange={(e) => onChange(e.target.value ? [e.target.value] : [])}>
        <option value="">未设置</option>
        <option value="yes">yes</option>
        <option value="no">no</option>
      </select>
    )
  }
  if (param.kind === 'enum') {
    const v = slice[0] ?? ''
    return (
      <select className="cond-select" value={v} onChange={(e) => onChange(e.target.value ? [e.target.value] : [])}>
        <option value="">未设置</option>
        {(param.values ?? []).map((x) => (
          <option key={x} value={x}>
            {x}
          </option>
        ))}
        {v && !(param.values ?? []).includes(v) && <option value={v}>{v}</option>}
      </select>
    )
  }
  if (param.kind === 'number') {
    const isOp = slice.length >= 2 && isCondOperator(slice[0])
    const op = isOp ? slice[0] : '='
    const val = isOp ? slice.slice(1).join(' ') : slice.join(' ')
    return (
      <span className="cond-num">
        <select
          className="cond-select cond-op"
          value={op}
          onChange={(e) => {
            const nop = e.target.value
            if (val === '') {
              onChange([])
            } else if (nop === '=') {
              onChange([val])
            } else {
              onChange([nop, val])
            }
          }}
        >
          {OPS.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        <input
          className="text-input cond-num-val"
          value={val}
          placeholder="数值"
          onChange={(e) => {
            const v = e.target.value.trim()
            if (v === '') onChange([])
            else if (op === '=') onChange([v])
            else onChange([op, v])
          }}
        />
      </span>
    )
  }
  const v = slice.join(' ')
  return (
    <input
      className="text-input cond-str"
      value={v}
      placeholder={param.hint ?? ''}
      onChange={(e) => {
        const t = e.target.value.trim()
        onChange(t ? t.split(/\s+/) : [])
      }}
    />
  )
}

// ---------- 单行 ----------

function CondRow({
  node,
  path,
  onChange,
  onRemove,
  onAddChild,
  top
}: {
  node: CondNode
  path: number[]
  onChange: (n: CondNode) => void
  onRemove: () => void
  onAddChild: () => void
  top: boolean
}): React.JSX.Element {
  const spec = condSpec(node.key)
  const scalarParams = spec?.params?.filter((p) => !p.block) ?? []
  const blockParams = spec?.params?.filter((p) => p.block) ?? []

  // 当前位置的参数切片
  const slices = useMemo(() => {
    const out: string[][] = []
    let cursor = 0
    for (const p of scalarParams) {
      if (p.kind === 'number') {
        const a0 = node.args[cursor]
        if (a0 !== undefined && isCondOperator(a0)) {
          out.push(node.args.slice(cursor, cursor + 2))
          cursor += 2
        } else {
          out.push(a0 !== undefined ? [a0] : [])
          cursor += 1
        }
      } else {
        const a = node.args[cursor]
        out.push(a !== undefined ? [a] : [])
        cursor += 1
      }
    }
    return out
  }, [node.args, scalarParams])

  const extras = useMemo(() => {
    let cursor = 0
    for (const p of scalarParams) {
      if (p.kind === 'number') {
        const a0 = node.args[cursor]
        cursor += a0 !== undefined && isCondOperator(a0) ? 2 : 1
      } else {
        cursor += 1
      }
    }
    return node.args.slice(cursor)
  }, [node.args, scalarParams])

  const extraChildren = node.children.filter((c) => !blockParams.some((p) => p.name === c.key))

  return (
    <div className={top ? 'cond-row top' : 'cond-row'}>
      <div className="cond-row-head">
        <KeyInput
          value={node.key}
          onPick={(k) => onChange({ ...node, key: k })}
          onType={(k) => onChange({ ...node, key: k })}
        />
        {spec && (
          <>
            <span className={`cond-kind-badge ${spec.kind}`}>{KIND_ZH[spec.kind]}</span>
            {spec.scope && <span className="cond-scope">作用域：{spec.scope}</span>}
          </>
        )}
        <button className="cond-del" title="删除这一行" onClick={onRemove}>
          ×
        </button>
      </div>

      {spec && <div className="cond-zh">{spec.zh}</div>}

      {(scalarParams.length > 0 || blockParams.length > 0) && (
        <div className="cond-params">
          {scalarParams.map((p, i) => (
            <span className="cond-param" key={p.name}>
              <span className="cond-param-name" title={p.hint ?? p.name}>
                {p.name}
              </span>
              <ParamField
                param={p}
                slice={slices[i] ?? []}
                onChange={(slice) => {
                  const args = setParamSlice(node, spec!, i, slice)
                  onChange({ ...node, args })
                }}
              />
            </span>
          ))}
          {blockParams.map((p) => {
            const child = node.children.find((c) => c.key === p.name)
            return (
              <span className="cond-param block" key={p.name}>
                <span className="cond-param-name" title={p.hint ?? p.name}>
                  {p.name}
                </span>
                <ParamField
                  param={p}
                  slice={child?.args ?? []}
                  onChange={(slice) => {
                    if (slice.length === 0) {
                      onChange({ ...node, children: node.children.filter((c) => c.key !== p.name) })
                    } else {
                      const other = node.children.filter((c) => c.key !== p.name)
                      onChange({ ...node, children: [...other, { key: p.name, args: slice, children: [] }] })
                    }
                  }}
                />
              </span>
            )
          })}
        </div>
      )}

      {extras.length > 0 && (
        <div className="cond-extras">
          <span className="cond-extras-label">额外参数</span>
          {extras.map((a, i) => (
            <span className="cond-extra" key={i}>
              {a}
              <button
                title="删除"
                onClick={() => onChange({ ...node, args: node.args.filter((_, j) => j !== scalarParamSpanEnd(node, spec, i)) })}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {(extraChildren.length > 0 || !spec) && (
        <div className="cond-children">
          {extraChildren.map((c, i) => (
            <CondRow
              key={i}
              node={c}
              path={[...path, node.children.indexOf(c)]}
              onChange={(n2) => {
                const idx = node.children.indexOf(c)
                const next = node.children.map((x, j) => (j === idx ? n2 : x))
                onChange({ ...node, children: next })
              }}
              onRemove={() => {
                const idx = node.children.indexOf(c)
                onChange({ ...node, children: node.children.filter((_, j) => j !== idx) })
              }}
              onAddChild={() => onChange({ ...node, children: [...node.children, { key: '', args: [], children: [] }] })}
              top={false}
            />
          ))}
        </div>
      )}
      {!spec && (
        <input
          className="text-input cond-free"
          value={node.args.join(' ')}
          placeholder="自由写法，如 > 0.5 或 = yes（可留空）"
          onChange={(e) => {
            const t = e.target.value.trim()
            onChange({ ...node, args: t ? t.split(/\s+/) : [] })
          }}
        />
      )}

      <button className="cond-add-child" onClick={onAddChild}>
        ＋ 添加子项
      </button>
    </div>
  )
}

/** 帮助 extra 删除按钮定位原 args 下标（简化：直接返回该 extra 在 extras 里的全局起点） */
function scalarParamSpanEnd(node: CondNode, spec: CondSpec | undefined, extraIdx: number): number {
  const scalarParams = spec?.params?.filter((p) => !p.block) ?? []
  let cursor = 0
  for (const p of scalarParams) {
    if (p.kind === 'number') {
      const a0 = node.args[cursor]
      cursor += a0 !== undefined && isCondOperator(a0) ? 2 : 1
    } else {
      cursor += 1
    }
  }
  return cursor + extraIdx
}

// ---------- 模态框 ----------

interface Props {
  blockKey: string
  nodes: CondNode[]
  /** 文件自身的换行符（预览用，与写入结果一致） */
  newline?: string
  /** 覆盖 COND_BLOCK_META 的标题/说明（自定义块用，如快捷路径的 trigger） */
  meta?: { zh: string; desc: string }
  onApply: (nodes: CondNode[]) => void
  onClose: () => void
}

export default function ConditionEditor({ blockKey, nodes, newline, meta: metaOverride, onApply, onClose }: Props): React.JSX.Element {
  const [state, setState] = useState<CondNode[]>(() => JSON.parse(JSON.stringify(nodes)) as CondNode[])
  const [showRef, setShowRef] = useState(false)
  const meta = metaOverride ?? COND_BLOCK_META[blockKey] ?? { zh: blockKey, desc: '' }

  const update = (path: number[], fn: (n: CondNode) => CondNode): void => setState((prev) => updateAt(prev, path, fn))
  const remove = (path: number[]): void => setState((prev) => removeAt(prev, path))
  const addChild = (path: number[], node: CondNode): void => setState((prev) => addChildAt(prev, path, node))
  const addTop = (key: string): void => setState((prev) => [...prev, { key, args: [], children: [] }])

  const preview = useMemo(() => condBlockText(blockKey, state, newline ?? '\n'), [blockKey, state, newline])

  return (
    <>
      <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
        <div className="modal cond-editor">
          <div className="cond-head">
            <div className="cond-head-row">
              <h3>
                {meta.zh} <code>{blockKey}</code>
              </h3>
              <button className="btn tiny" onClick={() => setShowRef(true)}>
                📖 对照表
              </button>
            </div>
            <p>{meta.desc}</p>
          </div>
          <div className="cond-body">
            {state.map((n, i) => (
              <CondRow
                key={i}
                node={n}
                path={[i]}
                onChange={(n2) => update([i], () => n2)}
                onRemove={() => remove([i])}
                onAddChild={() => addChild([i], { key: '', args: [], children: [] })}
                top={true}
              />
            ))}
            {state.length === 0 && <div className="cond-empty">（空）留空保存 = 删除整个 {blockKey} 块</div>}
            <div className="cond-add-row">
              <KeyInput value="" onPick={addTop} onType={() => {}} placeholder="＋ 添加条件 / 效果…" />
            </div>
          </div>
          <div className="cond-preview">
            <div className="cond-preview-title">写入文件的原文预览</div>
            <pre>{preview}</pre>
          </div>
          <div className="cond-foot">
            <button className="btn small" onClick={onClose}>
              取消
            </button>
            <button
              className="btn small primary"
              onClick={() => {
                // 递归清掉空键的废行
                const cleanTree = (list: CondNode[]): CondNode[] =>
                  list.filter((n) => n.key.trim() !== '').map((n) => ({ ...n, children: cleanTree(n.children) }))
                onApply(cleanTree(state))
              }}
            >
              确定
            </button>
          </div>
        </div>
      </div>
      {showRef && (
        <RefTable
          title="条件 / 效果对照表"
          rows={REF_ROWS}
          cats={REF_CATS}
          search={suggestCondKeys}
          onPick={(k) => {
            addTop(k)
            setShowRef(false)
          }}
          onClose={() => setShowRef(false)}
        />
      )}
    </>
  )
}
