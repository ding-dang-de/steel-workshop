import { useEffect, useMemo, useState } from 'react'
import { MODIFIER_CATALOG, MOD_CAT_ZH } from '../../../shared/modifiers'

/**
 * 中英文代码对照表（分类浏览 + 中文搜索，点击条目插入）
 * 纯受控模态框，数据由调用方传入（条件目录 / 修饰符目录），StrictMode 安全。
 */

export interface RefRow {
  key: string
  zh: string
  /** 已本地化的分类名 */
  cat: string
  /** 类型徽章文字（效果/条件/逻辑/%），无则不显示 */
  badge?: string
  badgeClass?: 'effect' | 'trigger' | 'logic' | 'pct'
  scope?: string
}

/** 修饰符对照表数据（IdeasEditor / TraitsEditor 用） */
export const MOD_REF_ROWS: RefRow[] = MODIFIER_CATALOG.map((s) => ({
  key: s.key,
  zh: s.zh,
  cat: s.cat,
  badge: s.pct ? '%' : undefined,
  badgeClass: s.pct ? 'pct' : undefined
}))

export const MOD_REF_CATS: { id: string; zh: string }[] = MOD_CAT_ZH.map((c) => ({ id: c, zh: c }))

interface Props {
  title: string
  rows: RefRow[]
  cats: { id: string; zh: string }[]
  /** 模块级查询函数（引用稳定）：按关键词返回条目 key，如 suggestCondKeys */
  search: (q: string, limit: number) => { key: string }[]
  onPick: (key: string) => void
  onClose: () => void
}

export default function RefTable({ title, rows, cats, search, onPick, onClose }: Props): React.JSX.Element {
  const [tab, setTab] = useState('')
  const [q, setQ] = useState('')

  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const byKey = useMemo(() => new Map(rows.map((r) => [r.key, r])), [rows])

  const counts = useMemo(() => {
    const m = new Map<string, number>()
    m.set('', rows.length)
    for (const r of rows) m.set(r.cat, (m.get(r.cat) ?? 0) + 1)
    return m
  }, [rows])

  const list = useMemo(() => {
    let src = rows
    if (q.trim()) {
      const seen = new Set<string>()
      const picked: RefRow[] = []
      for (const s of search(q, 500)) {
        const r = byKey.get(s.key)
        if (r && !seen.has(r.key)) {
          seen.add(r.key)
          picked.push(r)
        }
      }
      src = picked
    }
    return tab === '' ? src : src.filter((r) => r.cat === tab)
  }, [rows, q, tab, search, byKey])

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal ref-table">
        <div className="ref-head">
          <h3>{title}</h3>
          <input
            className="text-input"
            value={q}
            placeholder="搜索中文说明或英文代码…"
            onChange={(e) => {
              setQ(e.target.value)
              // 搜索面向全目录：输入非空关键词时自动切回「全部」页签，避免分类过滤藏掉结果
              if (e.target.value.trim()) setTab('')
            }}
          />
          <button className="btn tiny" onClick={onClose}>
            关闭
          </button>
        </div>
        <div className="ref-tabs">
          <div className={tab === '' ? 'ref-tab active' : 'ref-tab'} onClick={() => setTab('')}>
            全部<span className="ref-count">{counts.get('')}</span>
          </div>
          {cats.map((c) => (
            <div key={c.id} className={tab === c.id ? 'ref-tab active' : 'ref-tab'} onClick={() => setTab(c.id)}>
              {c.zh}<span className="ref-count">{counts.get(c.id) ?? 0}</span>
            </div>
          ))}
        </div>
        <div className="ref-list">
          {list.map((r) => (
            <div key={r.key} className="ref-row" onClick={() => onPick(r.key)}>
              <span className="ref-key">{r.key}</span>
              {r.badge && <span className={`cond-kind-badge ${r.badgeClass ?? ''}`}>{r.badge}</span>}
              <span className="ref-zh">{r.zh}</span>
              {r.scope && <span className="ref-scope">{r.scope}</span>}
            </div>
          ))}
          {list.length === 0 && <div className="ref-empty">没有匹配的条目，换个关键词或切到「全部」分类</div>}
        </div>
      </div>
    </div>
  )
}
