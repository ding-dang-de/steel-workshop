import { useCallback, useEffect, useRef, useState } from 'react'
import {
  loadLoc,
  saveLoc,
  setLocText,
  addLocKey,
  deleteLocKey,
  fillMissingFocusLoc,
  checkMissingFocusLoc
} from '../../../shared/localisation'
import type { LocFile } from '../../../shared/localisation'

/**
 * 本地化编辑器（阶段① 第二块：本地化编辑器）
 * 键列表 + 文本编辑 + 国策名称联动（检测缺失的 id / id_desc 键，一键补全）。
 * 无损：只改写编辑过的条目；撤销/重做/自动备份与国策编辑器同一套机制。
 */

interface Props {
  path: string
  content: string
  /** 模组内全部国策树的国策 id；null 表示正在读取 */
  focusIds: string[] | null
  /** 国策反向联动：从画布跳转过来的目标键；token 变化才重新定位 */
  jumpKey: string | null
  jumpToken: number
  /** 跳转时若键缺失，自动补全名称+描述（一步撤销） */
  autofill: boolean
  /** 补全时只加这一个键本身（事件标题/描述等用），不加 _desc */
  autofillKeyOnly: boolean
  onSaved: (text: string) => void
  onUnsavedChange: (dirty: boolean) => void
  /** 双栏中本栏是否激活；非激活栏不响应全局快捷键（默认 true，单栏用法不传） */
  active?: boolean
}

export default function LocalisationEditor({
  path,
  content,
  focusIds,
  jumpKey,
  jumpToken,
  autofill,
  autofillKeyOnly,
  onSaved,
  onUnsavedChange,
  active
}: Props): React.JSX.Element {
  /** 渲染期赋值让 keydown 闭包始终读到最新激活状态（effect 依赖不变，避免反复挂卸监听） */
  const activeRef = useRef(active ?? true)
  activeRef.current = active ?? true
  const locRef = useRef<LocFile | null>(null)
  const historyRef = useRef<{ past: string[]; future: string[] }>({ past: [], future: [] })
  const draftRef = useRef<{ key: string; text: string } | null>(null)
  /** 当前模型所基于的内容；保存回流的内容与之一致时跳过重建，保留撤销历史 */
  const loadedContentRef = useRef<string | null>(null)
  /** 最新 mutate 的引用（跳转 effect 不依赖其身份，避免父组件重渲染导致重复触发） */
  const mutateRef = useRef<(fn: (l: LocFile) => void) => void>(() => {})
  const [tick, setTick] = useState(0)
  const [filter, setFilter] = useState('')
  const [onlyPlaceholder, setOnlyPlaceholder] = useState(false)
  const [selection, setSelection] = useState<string | null>(null)
  const [jumpHighlight, setJumpHighlight] = useState<string | null>(null)
  const [loadError, setLoadError] = useState('')
  const [statusMsg, setStatusMsg] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    // 保存回流的内容：模型已与之一致，跳过重建（否则撤销历史会被清空，保存后无法 Ctrl+Z）
    if (content === loadedContentRef.current) return
    loadedContentRef.current = content
    const loc = loadLoc(content)
    locRef.current = loc
    historyRef.current = { past: [], future: [] }
    draftRef.current = null
    setSelection(null)
    setLoadError(loc ? '' : '无法解析该文件为本地化文件')
    setStatusMsg('')
    onUnsavedChange(false)
    setTick((t) => t + 1)
  }, [path, content, onUnsavedChange])

  const mutate = useCallback(
    (fn: (l: LocFile) => void): void => {
      const l = locRef.current
      if (!l) return
      historyRef.current = { past: [...historyRef.current.past.slice(-99), saveLoc(l)], future: [] }
      fn(l)
      onUnsavedChange(true)
      setTick((t) => t + 1)
    },
    [onUnsavedChange]
  )

  // 保持 mutateRef 为最新（在跳转 effect 之前运行）
  useEffect(() => {
    mutateRef.current = mutate
  }, [mutate])

  // 国策反向联动：从画布跳转过来时定位到目标键（缺失时按 autofill 自动补全，一步撤销）
  useEffect(() => {
    if (!jumpKey || jumpToken === 0) return
    const l = locRef.current
    setJumpHighlight(jumpKey)
    if (l && !l.byKey.has(jumpKey) && autofill) {
      mutateRef.current((m) => {
        if (autofillKeyOnly) addLocKey(m, jumpKey, jumpKey)
        else fillMissingFocusLoc(m, [jumpKey])
      })
    }
    if (l?.byKey.has(jumpKey) || autofill) setSelection(jumpKey)
    // 等 React 完成重渲染（补全的新行出现）再滚动
    const t = window.setTimeout(() => {
      const row =
        document.querySelector(`[data-loc-key="${CSS.escape(jumpKey)}"]`) ??
        [...document.querySelectorAll('.loc-missing-row')].find(
          (r) => r.querySelector('.loc-missing-id')?.textContent === jumpKey
        )
      row?.scrollIntoView({ block: 'center' })
    }, 150)
    return () => window.clearTimeout(t)
  }, [jumpKey, jumpToken, autofill, autofillKeyOnly])

  const undo = useCallback((): void => {
    const l = locRef.current
    const h = historyRef.current
    if (!l) return
    const prev = h.past[h.past.length - 1]
    if (prev === undefined) return
    const restored = loadLoc(prev)
    if (!restored) return
    h.past.pop()
    h.future.unshift(saveLoc(l))
    locRef.current = restored
    draftRef.current = null
    onUnsavedChange(h.past.length > 0)
    setTick((t) => t + 1)
  }, [onUnsavedChange])

  const redo = useCallback((): void => {
    const l = locRef.current
    const h = historyRef.current
    if (!l) return
    const next = h.future[0]
    if (next === undefined) return
    const restored = loadLoc(next)
    if (!restored) return
    h.future.shift()
    h.past.push(saveLoc(l))
    locRef.current = restored
    draftRef.current = null
    onUnsavedChange(true)
    setTick((t) => t + 1)
  }, [onUnsavedChange])

  /** 把编辑框里的草稿写回模型（一行一步撤销） */
  const commitDraft = useCallback((): void => {
    const d = draftRef.current
    draftRef.current = null
    const l = locRef.current
    if (!d || !l) return
    const cur = l.byKey.get(d.key)
    if (!cur || cur.text === d.text) return
    mutate((m) => setLocText(m, d.key, d.text))
  }, [mutate])

  const save = useCallback(async (): Promise<void> => {
    commitDraft()
    const l = locRef.current
    if (!l || saving) return
    setSaving(true)
    try {
      const text = saveLoc(l)
      await window.api.writeTextFile(path, text)
      onUnsavedChange(false)
      setStatusMsg('已保存（修改前的文件已自动备份）')
      loadedContentRef.current = text
      onSaved(text)
    } catch (err) {
      setStatusMsg(`保存失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSaving(false)
    }
  }, [commitDraft, path, saving, onSaved, onUnsavedChange])

  const revert = useCallback((): void => {
    if (historyRef.current.past.length > 0 && !window.confirm('确定放弃所有未保存的修改？')) return
    loadedContentRef.current = content
    const loc = loadLoc(content)
    locRef.current = loc
    historyRef.current = { past: [], future: [] }
    draftRef.current = null
    onUnsavedChange(false)
    setStatusMsg('已还原为磁盘上的内容')
    setTick((t) => t + 1)
  }, [content, onUnsavedChange])

  // 快捷键：Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y / Ctrl+S（Ctrl+S 在文本框里也生效）
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!activeRef.current) return
      const t = e.target as HTMLElement | null
      const inField = t !== null && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      if (e.ctrlKey || e.metaKey) {
        const k = e.key.toLowerCase()
        if (k === 'z') {
          if (inField) return
          e.preventDefault()
          if (e.shiftKey) redo()
          else undo()
        } else if (k === 'y') {
          if (inField) return
          e.preventDefault()
          redo()
        } else if (k === 's') {
          e.preventDefault()
          void save()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo, save])

  const loc = locRef.current
  const entries = loc?.entries ?? []
  const missing = loc && focusIds ? checkMissingFocusLoc(loc, focusIds) : null
  const placeholderCount = entries.filter((e) => e.placeholder).length
  const missingNameCount = missing?.filter((m) => m.missingName).length ?? 0
  const missingDescCount = missing?.filter((m) => m.missingDesc).length ?? 0

  const f = filter.trim().toLowerCase()
  const filtered = entries.filter((e) => {
    if (onlyPlaceholder && !e.placeholder) return false
    if (!f) return true
    return e.key.toLowerCase().includes(f) || e.text.toLowerCase().includes(f)
  })

  const selEntry = selection !== null ? (loc?.byKey.get(selection) ?? null) : null
  const selMissingDesc = selEntry && focusIds?.includes(selEntry.key) ? !loc?.byKey.has(`${selEntry.key}_desc`) : false

  const selectKey = (key: string): void => {
    commitDraft()
    setSelection(key)
    setJumpHighlight(null)
  }

  const newKeyRef = useRef<HTMLInputElement | null>(null)

  const addNewKey = (): void => {
    const key = newKeyRef.current?.value.trim() ?? ''
    if (!key) return
    if (loc?.byKey.has(key)) {
      setStatusMsg(`键「${key}」已存在`)
      setSelection(key)
      return
    }
    mutate((l) => addLocKey(l, key, key))
    setSelection(key)
    setStatusMsg(`已添加「${key}」（文本为占位，请在右侧翻译）`)
    if (newKeyRef.current) newKeyRef.current.value = ''
  }

  if (loadError && !locRef.current) {
    return (
      <div className="viewer-empty">
        <p>{loadError}</p>
        <p className="viewer-empty-note">请切换到「文本」模式查看原始内容。</p>
      </div>
    )
  }

  return (
    <div className="loc-editor">
      <div className="loc-toolbar">
        <button className="btn small primary" disabled={saving} onClick={() => void save()}>
          {saving ? '保存中…' : '保存'}
        </button>
        <button className="btn small" onClick={revert}>
          还原
        </button>
        <button className="btn small" disabled={historyRef.current.past.length === 0} onClick={undo}>
          ↶ 撤销
        </button>
        <button className="btn small" disabled={historyRef.current.future.length === 0} onClick={redo}>
          ↷ 重做
        </button>
        <span className="fe-sep" />
        <input className="text-input loc-filter" placeholder="搜索键名或文本…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button
          className={onlyPlaceholder ? 'loc-chip on' : 'loc-chip'}
          title="文本与键名相同或为空 = 未翻译"
          onClick={() => setOnlyPlaceholder((v) => !v)}
        >
          只看未翻译
        </button>
        <span className="fe-spacer" />
        <input
          className="text-input loc-newkey"
          ref={newKeyRef}
          placeholder="新键名（如 my_event_title）…"
          onKeyDown={(e) => {
            if (e.key === 'Enter') addNewKey()
          }}
        />
        <button className="btn small" onClick={addNewKey}>
          ＋ 新键
        </button>
        <span className="loc-stats">
          {entries.length} 条 · 未翻译 {placeholderCount}
          {missing && missing.length > 0 && (
            <>
              {' '}
              · 缺名称 {missingNameCount} · 缺描述 {missingDescCount}
            </>
          )}
          {focusIds === null && ' · 正在读取国策树…'}
        </span>
      </div>

      {missing && missing.length > 0 && (
        <div className="loc-missing-panel">
          <div className="loc-missing-head">
            <span className="loc-missing-title">
              🔗 国策名称联动：{missing.length} 个国策缺少本地化（缺名称 {missingNameCount} · 缺描述 {missingDescCount}）
            </span>
            <span className="loc-missing-note">名称默认用键名占位、描述默认为空，之后在左侧列表里翻译</span>
            <span className="fe-spacer" />
            <button
              className="btn small primary"
              onClick={() => {
                mutate((l) => fillMissingFocusLoc(l, focusIds ?? []))
                setStatusMsg('已补全全部缺失键（可在撤销中恢复）')
              }}
            >
              ⚡ 一键补全全部
            </button>
          </div>
          <div className="loc-missing-list">
            {missing.map((m) => (
              <span className={jumpHighlight === m.id ? 'loc-missing-row loc-jump' : 'loc-missing-row'} key={m.id}>
                <span className="loc-missing-id">{m.id}</span>
                {m.missingName && (
                  <button
                    className="btn tiny"
                    onClick={() => {
                      mutate((l) => addLocKey(l, m.id, m.id))
                      setSelection(m.id)
                    }}
                  >
                    补名称
                  </button>
                )}
                {m.missingDesc && (
                  <button
                    className="btn tiny"
                    onClick={() => {
                      mutate((l) => addLocKey(l, `${m.id}_desc`, ''))
                      setSelection(m.id)
                    }}
                  >
                    补描述
                  </button>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="loc-main">
        <div className="loc-list">
          {filtered.map((e) => (
            <button
              key={e.key}
              data-loc-key={e.key}
              className={
                selection === e.key
                  ? jumpHighlight === e.key
                    ? 'loc-row active loc-jump'
                    : 'loc-row active'
                  : jumpHighlight === e.key
                    ? 'loc-row loc-jump'
                    : 'loc-row'
              }
              onClick={() => selectKey(e.key)}
            >
              <span className="loc-key">
                {e.key}
                {e.placeholder && <span className="loc-badge">未翻译</span>}
              </span>
              <span className="loc-preview">{e.text.trim() === '' ? '（空）' : e.text.replace(/\n/g, ' ⏎ ')}</span>
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="loc-list-empty">
              {onlyPlaceholder && !f ? '没有未翻译的条目 🎉' : '没有匹配的条目'}
            </div>
          )}
        </div>

        <div className="loc-edit">
          {selEntry ? (
            <>
              <div className="loc-edit-head">
                <span className="loc-edit-key" title={selEntry.fullKey}>
                  {selEntry.fullKey}
                </span>
                <span className="fe-spacer" />
                <button
                  className="btn tiny"
                  title="删除这一行（可撤销）"
                  onClick={() => {
                    if (!window.confirm(`确定删除「${selEntry.key}」？可以用 Ctrl+Z 撤销`)) return
                    mutate((l) => deleteLocKey(l, selEntry.key))
                    setSelection(null)
                  }}
                >
                  删除条目
                </button>
                {selMissingDesc && (
                  <button
                    className="btn tiny"
                    title="这个国策缺少描述键"
                    onClick={() => mutate((l) => addLocKey(l, `${selEntry.key}_desc`, ''))}
                  >
                    补全描述
                  </button>
                )}
              </div>
              <textarea
                className="loc-textarea"
                spellCheck={false}
                value={draftRef.current && draftRef.current.key === selEntry.key ? draftRef.current.text : selEntry.text}
                onChange={(e) => {
                  draftRef.current = { key: selEntry.key, text: e.target.value }
                  setTick((t) => t + 1)
                }}
                onBlur={commitDraft}
                placeholder="输入翻译文本（支持换行；失焦或保存时生效）"
              />
              <div className="loc-edit-note">
                {selEntry.placeholder
                  ? '⚠ 当前是占位文本（与键名相同或为空），游戏里会原样显示，记得翻译。'
                  : '编辑后点击别处或按 Ctrl+S 即写入（一步撤销）。'}
              </div>
            </>
          ) : (
            <div className="viewer-empty">
              <p className="viewer-empty-title">选择左侧键名开始编辑</p>
              <p>搜索框可以按键名或翻译文本过滤；「只看未翻译」列出所有占位条目。</p>
              <p className="viewer-empty-note">Ctrl+Z 撤销 · Ctrl+S 保存 · 保存前自动备份最近 10 份</p>
            </div>
          )}
          {statusMsg && <div className="loc-status">{statusMsg}</div>}
        </div>
      </div>
    </div>
  )
}
