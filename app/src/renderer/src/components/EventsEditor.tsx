import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  loadEvents,
  saveEvents,
  buildEvents,
  EVENT_TYPES,
  setEventId,
  setEventType,
  setEventTitle,
  setEventDesc,
  setEventPicture,
  setEventFlag,
  getEventCondBlock,
  setEventCondBlock,
  getOptionEffects,
  setOptionEffects,
  setOptionName,
  addEvent,
  deleteEvent,
  suggestEventId,
  hasEvent,
  addOption,
  deleteOption
} from '../../../shared/events'
import type { EventsModel, EventDef } from '../../../shared/events'
import ConditionEditor from './ConditionEditor'
import IconPicker from './IconPicker'
import { useSpriteCatalog } from '../hooks/useSpriteCatalog'
import { useLocIndex } from '../hooks/useLocIndex'

/**
 * 事件编辑器（第二期第一块）
 * 事件列表 + 结构化编辑：类型/id/标题/描述/图片、手动触发或条件触发（trigger + MTTH）、
 * 立即效果、多个选项（名称、显示条件、AI 权重、效果）。
 * 条件/效果复用结构化编辑器；标题/描述与本地化编辑器双向联动（缺失键一键补全）；
 * 无损只重写改动条目；撤销/重做/自动备份与其它编辑器同一套机制。
 */

const EVENT_TYPE_ZH: Record<string, string> = {
  country_event: '国家事件',
  news_event: '新闻事件',
  state_event: '州事件',
  unit_leader_event: '将领事件',
  operative_leader_event: '特工领袖事件',
  decolonization_event: '去殖民化事件'
}

interface Props {
  path: string
  content: string
  gameDir: string | null
  modPath: string
  /** 模组内的本地化文件（标题/描述/选项名联动） */
  locFiles: { path: string; rel: string }[]
  /** 模组内全部国策树的国策 id；null 表示正在读取（选本地化文件用） */
  focusIds: string[] | null
  /** 跳转到本地化编辑器（autofill = 缺失键自动补全；keyOnly = 只补这一个键不加 _desc） */
  onOpenLoc: (key: string, locPath: string, autofill: boolean, keyOnly: boolean) => void
  /** 国策完成效果里的事件引用（eventId → 国策）；null 表示正在扫描 */
  eventRefs: { eventId: string; focusId: string; fileRel: string }[] | null
  /** 跳转到国策编辑器并选中节点 */
  onOpenFocus: (focusId: string, focusRel: string) => void
  /** 外部跳转：从国策编辑器点过来选中事件（autofill = 缺失时自动创建；token 变化才重新定位） */
  jumpId: string | null
  jumpToken: number
  jumpAutofill: boolean
  onSaved: (text: string) => void
  onUnsavedChange: (dirty: boolean) => void
  /** 双栏中本栏是否激活；非激活栏不响应全局快捷键（默认 true，单栏用法不传） */
  active?: boolean
}

export default function EventsEditor({
  path,
  content,
  gameDir,
  modPath,
  locFiles,
  focusIds,
  onOpenLoc,
  eventRefs,
  onOpenFocus,
  jumpId,
  jumpToken,
  jumpAutofill,
  onSaved,
  onUnsavedChange,
  active
}: Props): React.JSX.Element {
  /** 渲染期赋值让 keydown 闭包始终读到最新激活状态（effect 依赖不变，避免反复挂卸监听） */
  const activeRef = useRef(active ?? true)
  activeRef.current = active ?? true
  const modelRef = useRef<EventsModel | null>(null)
  const historyRef = useRef<{ past: string[]; future: string[] }>({ past: [], future: [] })
  /** 当前模型所基于的内容；保存回流的内容与之一致时跳过重建，保留撤销历史 */
  const loadedContentRef = useRef<string | null>(null)
  /** 外部跳转只应用一次（token 去重） */
  const jumpAppliedRef = useRef(0)
  const [tick, setTick] = useState(0)
  const [filter, setFilter] = useState('')
  const [selection, setSelection] = useState<string | null>(null)
  /** 结构化编辑弹窗：{ eventId, blockKey, optIndex? } */
  const [condModal, setCondModal] = useState<{ eventId: string; blockKey: string; optIndex?: number } | null>(null)
  const [showPicker, setShowPicker] = useState(false)
  const [saving, setSaving] = useState(false)
  const [statusMsg, setStatusMsg] = useState('')
  const [loadError, setLoadError] = useState('')

  const { sprites, spriteFor, getIconUrl } = useSpriteCatalog(gameDir, modPath)
  const { index: locIndex } = useLocIndex(locFiles)

  const nl = content.includes('\r\n') ? '\r\n' : '\n'

  useEffect(() => {
    // 保存回流的内容：模型已与之一致，跳过重建（否则撤销历史会被清空）
    if (content === loadedContentRef.current) return
    loadedContentRef.current = content
    const model = loadEvents(content)
    modelRef.current = model
    historyRef.current = { past: [], future: [] }
    setSelection(model && model.events.length > 0 ? model.events[0].id : null)
    setLoadError(model ? '' : '无法解析该文件为事件文件')
    setStatusMsg('')
    onUnsavedChange(false)
    setTick((t) => t + 1)
  }, [path, content, onUnsavedChange])

  const mutate = useCallback(
    (fn: (m: EventsModel) => void): void => {
      const m = modelRef.current
      if (!m) return
      historyRef.current = { past: [...historyRef.current.past.slice(-99), saveEvents(m)], future: [] }
      fn(m)
      onUnsavedChange(true)
      setTick((t) => t + 1)
    },
    [onUnsavedChange]
  )

  // 外部跳转（从国策编辑器点过来）：缺失事件自动创建（一步撤销），选中并滚动到对应行
  useEffect(() => {
    if (jumpToken === 0 || jumpAppliedRef.current === jumpToken) return
    jumpAppliedRef.current = jumpToken
    const m = modelRef.current
    if (!m || !jumpId) return
    if (jumpAutofill && !hasEvent(m, jumpId)) {
      mutate((mm) => {
        addEvent(mm, 'country_event', jumpId)
      })
    }
    setSelection(jumpId)
    requestAnimationFrame(() => {
      document.querySelector(`.ev-editor .loc-row[data-id="${CSS.escape(jumpId)}"]`)?.scrollIntoView({ block: 'center' })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpToken, jumpId, jumpAutofill, mutate])

  const undo = useCallback((): void => {
    const m = modelRef.current
    const h = historyRef.current
    if (!m) return
    const prev = h.past[h.past.length - 1]
    if (prev === undefined) return
    const restored = loadEvents(prev)
    if (!restored) return
    h.past.pop()
    h.future.unshift(saveEvents(m))
    modelRef.current = restored
    onUnsavedChange(h.past.length > 0)
    setTick((t) => t + 1)
  }, [onUnsavedChange])

  const redo = useCallback((): void => {
    const m = modelRef.current
    const h = historyRef.current
    if (!m) return
    const next = h.future[0]
    if (next === undefined) return
    const restored = loadEvents(next)
    if (!restored) return
    h.future.shift()
    h.past.push(saveEvents(m))
    modelRef.current = restored
    onUnsavedChange(true)
    setTick((t) => t + 1)
  }, [onUnsavedChange])

  const save = useCallback(async (): Promise<void> => {
    const m = modelRef.current
    if (!m || saving) return
    setSaving(true)
    try {
      const text = saveEvents(m)
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
  }, [path, saving, onSaved, onUnsavedChange])

  const revert = useCallback((): void => {
    if (historyRef.current.past.length > 0 && !window.confirm('确定放弃所有未保存的修改？')) return
    loadedContentRef.current = content
    const model = loadEvents(content)
    modelRef.current = model
    historyRef.current = { past: [], future: [] }
    setSelection(model && model.events.length > 0 ? model.events[0].id : null)
    onUnsavedChange(false)
    setStatusMsg('已还原为磁盘上的内容')
    setTick((t) => t + 1)
  }, [content, onUnsavedChange])

  // 快捷键：Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y / Ctrl+S
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

  // ---------- 派生状态 ----------

  const events = useMemo(() => (modelRef.current ? buildEvents(modelRef.current.file).events : []), [tick])
  const sel = selection !== null ? (events.find((e) => e.id === selection) ?? null) : null

  const findIn = (m: EventsModel, id: string): EventDef | null => buildEvents(m.file).events.find((e) => e.id === id) ?? null

  const f = filter.trim().toLowerCase()
  const filtered = events.filter((e) => {
    if (!f) return true
    return e.id.toLowerCase().includes(f) || e.type.toLowerCase().includes(f) || e.title.toLowerCase().includes(f)
  })

  /** 完成效果里触发了当前事件的国策引用 */
  const refs = useMemo(
    () => (eventRefs ?? []).filter((r) => r.eventId === sel?.id),
    [eventRefs, sel?.id]
  )

  // ---------- 本地化联动 ----------

  const locOf = (key: string): { text: string; placeholder: boolean; path: string } | null =>
    key && locIndex ? (locIndex.byKey.get(key) ?? null) : null

  /** 选目标本地化文件：键在哪个文件用哪个；缺失时选含本模组国策键最多的文件（用户平时翻译的文件） */
  const pickLocPath = (key: string): string | null => {
    if (!locIndex || locIndex.paths.length === 0) return null
    const hit = locIndex.byKey.get(key)
    if (hit) return hit.path
    const score = new Map<string, number>()
    for (const fid of focusIds ?? []) {
      const v = locIndex.byKey.get(fid)
      if (v) score.set(v.path, (score.get(v.path) ?? 0) + 1)
    }
    const ns = modelRef.current?.namespace ?? ''
    for (const [k, v] of locIndex.byKey) {
      if (k.startsWith(`${ns}.`) || k.startsWith(`${ns}_`)) score.set(v.path, (score.get(v.path) ?? 0) + 1)
    }
    let best: string | null = null
    let bestScore = -1
    for (const [p, s] of score) {
      if (s > bestScore) {
        bestScore = s
        best = p
      }
    }
    return best ?? locIndex.paths[0]
  }

  const jumpLoc = (key: string): void => {
    if (!key) return
    const p = pickLocPath(key)
    if (p) onOpenLoc(key, p, !locOf(key), true)
  }

  const locBadge = (key: string): React.JSX.Element | null => {
    if (!key) return null
    const hit = locOf(key)
    if (!hit) return <span className="fe-loc-badge missing">❌ 缺失</span>
    if (hit.placeholder) return <span className="fe-loc-badge warn">⚠ 占位未翻译</span>
    return <span className="fe-loc-badge ok">✅ 已翻译</span>
  }

  // ---------- 操作 ----------

  const addNew = (): void => {
    const m = modelRef.current
    if (!m) return
    const id = suggestEventId(m)
    mutate((mm) => {
      const e = addEvent(mm, 'country_event', id)
      setEventTitle(e, `${id}.t`)
      setEventDesc(e, `${id}.d`)
    })
    setSelection(id)
    setStatusMsg(`已添加事件「${id}」`)
  }

  const removeSelected = (): void => {
    if (!sel) return
    if (!window.confirm(`确定删除事件「${sel.id}」吗？可以撤销。`)) return
    mutate((m) => deleteEvent(m, sel.id))
    setSelection(null)
  }

  /** 选项名建议：id.a / id.b / …（避开已占用） */
  const suggestOptionName = (ev: EventDef): string => {
    const used = new Set(ev.options.map((o) => o.name))
    for (let i = 0; i < 78; i++) {
      const letter = String.fromCharCode(97 + (i % 26))
      const suffix = i < 26 ? letter : letter + (Math.floor(i / 26) + 1)
      const name = `${ev.id}.${suffix}`
      if (!used.has(name)) return name
    }
    return `${ev.id}.x`
  }

  const addNewOption = (): void => {
    if (!sel) return
    const name = suggestOptionName(sel)
    mutate((m) => {
      const ev = findIn(m, sel.id)
      if (ev) addOption(ev.entry, name, nl)
    })
    setStatusMsg(`已添加选项（名称键「${name}」，请在本地化里翻译）`)
  }

  const openCond = (blockKey: string, optIndex?: number): void => {
    if (!sel) return
    setCondModal({ eventId: sel.id, blockKey, optIndex })
  }

  /** 条件弹窗当前目标块的节点 */
  const condNodes = useMemo((): { nodes: unknown[] } | null => {
    if (!condModal || !sel) return null
    if (condModal.blockKey === 'option_effects') {
      const opt = sel.options[condModal.optIndex ?? 0]
      return opt ? { nodes: getOptionEffects(opt.entry) } : null
    }
    const target = condModal.optIndex === undefined ? sel.entry : sel.options[condModal.optIndex ?? 0]?.entry
    if (!target) return null
    return { nodes: getEventCondBlock(target, condModal.blockKey) ?? [] }
  }, [condModal, sel])

  // ---------- 渲染 ----------

  const curSprite = sel ? spriteFor(sel.picture) : undefined
  const curSpriteUrl = curSprite ? getIconUrl(curSprite) : null

  if (loadError && !modelRef.current) {
    return (
      <div className="viewer-empty">
        <p>{loadError}</p>
        <p className="viewer-empty-note">请切换到「文本」模式查看原始内容。</p>
      </div>
    )
  }

  return (
    <div className="loc-editor ev-editor">
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
        <input className="text-input loc-filter" placeholder="搜索事件 id 或标题键…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <span className="fe-spacer" />
        <button className="btn small" onClick={addNew}>
          ＋ 新建事件
        </button>
        <span className="loc-stats">{events.length} 个事件 · 命名空间 {modelRef.current?.namespace || '（无）'}</span>
      </div>

      <div className="loc-main">
        <div className="loc-list">
          {filtered.map((e) => (
            <button
              key={e.id}
              data-id={e.id}
              className={selection === e.id ? 'loc-row active' : 'loc-row'}
              onClick={() => setSelection(e.id)}
            >
              <span className="loc-key">
                <span className="ev-type">{EVENT_TYPE_ZH[e.type] ?? e.type}</span>
                {e.id}
                {e.options.length === 0 && <span className="loc-badge">无选项</span>}
              </span>
              <span className="loc-preview">
                {e.title ? (locOf(e.title)?.text ?? `标题键 ${e.title}`) : '（无标题键）'} · {e.options.length} 个选项
              </span>
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="loc-list-empty">
              {events.length === 0 ? '这个文件还没有事件，点右上角「＋ 新建事件」开始' : '没有匹配的事件'}
            </div>
          )}
        </div>

        <div className="loc-edit">
          {sel ? (
            <>
              <div className="loc-edit-head">
                <span className="loc-edit-key" title={sel.id}>
                  {sel.id}
                </span>
                <span className="fe-spacer" />
                <button className="btn tiny" onClick={removeSelected}>
                  删除事件
                </button>
              </div>

              <div className="fe-section-title">基本信息</div>
              <div className="fe-row">
                <label className="fe-field">
                  <span>事件类型</span>
                  <select
                    className="text-input"
                    value={sel.type}
                    onChange={(e) =>
                      mutate((m) => {
                        const ev = findIn(m, sel.id)
                        if (ev) setEventType(ev.entry, e.target.value)
                      })
                    }
                  >
                    {EVENT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {EVENT_TYPE_ZH[t]}（{t}）
                      </option>
                    ))}
                  </select>
                </label>
                <label className="fe-field">
                  <span>事件 id</span>
                  <input
                    className="text-input"
                    value={sel.id}
                    onChange={(e) =>
                      mutate((m) => {
                        const ev = findIn(m, sel.id)
                        if (ev) setEventId(ev.entry, e.target.value)
                      })
                    }
                  />
                </label>
              </div>

              <label className="fe-field">
                <span>事件图片（picture）</span>
                <div className="fe-icon-row">
                  <input
                    className="text-input"
                    value={sel.picture}
                    placeholder="如 GFX_news_event_generic"
                    onChange={(e) =>
                      mutate((m) => {
                        const ev = findIn(m, sel.id)
                        if (ev) setEventPicture(ev.entry, e.target.value)
                      })
                    }
                  />
                  <button className="btn small" onClick={() => setShowPicker(true)}>
                    选择…
                  </button>
                  {curSpriteUrl && <img className="ev-pic-preview" src={curSpriteUrl} alt="" />}
                </div>
              </label>

              <div className="fe-row ev-flags">
                <label className="ev-check">
                  <input
                    type="checkbox"
                    checked={sel.fireOnlyOnce}
                    onChange={(e) =>
                      mutate((m) => {
                        const ev = findIn(m, sel.id)
                        if (ev) setEventFlag(ev.entry, 'fire_only_once', e.target.checked)
                      })
                    }
                  />
                  只触发一次
                </label>
                <label className="ev-check">
                  <input
                    type="checkbox"
                    checked={sel.hidden}
                    onChange={(e) =>
                      mutate((m) => {
                        const ev = findIn(m, sel.id)
                        if (ev) setEventFlag(ev.entry, 'hidden', e.target.checked)
                      })
                    }
                  />
                  隐藏事件
                </label>
                <label className="ev-check">
                  <input
                    type="checkbox"
                    checked={sel.major}
                    onChange={(e) =>
                      mutate((m) => {
                        const ev = findIn(m, sel.id)
                        if (ev) setEventFlag(ev.entry, 'major', e.target.checked)
                      })
                    }
                  />
                  重大新闻
                </label>
              </div>

              <div className="fe-section-title">
                标题与描述键
                <span className="fe-title-note">与本地化编辑器联动，缺失可一键补全</span>
              </div>
              <div className="fe-row">
                <label className="fe-field">
                  <span>标题键（title）</span>
                  <input
                    className="text-input"
                    value={sel.title}
                    placeholder="如 france.1.t"
                    onChange={(e) =>
                      mutate((m) => {
                        const ev = findIn(m, sel.id)
                        if (ev) setEventTitle(ev.entry, e.target.value)
                      })
                    }
                  />
                </label>
                <label className="fe-field">
                  <span>描述键（desc）</span>
                  <input
                    className="text-input"
                    value={sel.desc}
                    placeholder="如 france.1.d"
                    onChange={(e) =>
                      mutate((m) => {
                        const ev = findIn(m, sel.id)
                        if (ev) setEventDesc(ev.entry, e.target.value)
                      })
                    }
                  />
                </label>
              </div>
              <div className="fe-loc-box">
                {locIndex === null ? (
                  <div className="fe-loc-text dim">正在读取本地化文件…</div>
                ) : locFiles.length === 0 ? (
                  <div className="fe-loc-text dim">模组里没有 localisation 文件</div>
                ) : (
                  <>
                    <div className="fe-loc-status">
                      标题 {locBadge(sel.title)}
                    </div>
                    <div className="fe-loc-text">{sel.title ? (locOf(sel.title)?.text ?? '（本地化文件中没有该键）') : '（未填标题键）'}</div>
                    <div className="fe-loc-status">
                      描述 {locBadge(sel.desc)}
                    </div>
                    <div className="fe-loc-text">{sel.desc ? (locOf(sel.desc)?.text ?? '（本地化文件中没有该键）') : '（未填描述键）'}</div>
                    <div className="fe-loc-actions">
                      <button
                        className="btn small primary"
                        disabled={!sel.title || locIndex === null || focusIds === null}
                        onClick={() => jumpLoc(sel.title)}
                      >
                        {sel.title && locOf(sel.title) ? '编辑标题本地化' : '补全并编辑标题'}
                      </button>
                      <button
                        className="btn small"
                        disabled={!sel.desc || locIndex === null || focusIds === null}
                        onClick={() => jumpLoc(sel.desc)}
                      >
                        {sel.desc && locOf(sel.desc) ? '编辑描述本地化' : '补全并编辑描述'}
                      </button>
                    </div>
                  </>
                )}
              </div>

              <div className="fe-section-title">触发方式</div>
              <div className="ev-modes">
                <label className="ev-mode">
                  <input
                    type="radio"
                    name="ev-trigger-mode"
                    checked={sel.isTriggeredOnly}
                    onClick={(e) => {
                      // 受控 radio 用 onClick：change 会在 React 同步回写 checked 后被吞掉
                      if (!e.currentTarget.checked) return
                      mutate((m) => {
                        const ev = findIn(m, sel.id)
                        if (ev) setEventFlag(ev.entry, 'is_triggered_only', true)
                      })
                    }}
                    onChange={() => {}}
                  />
                  手动触发（由国策/决议/其它事件调用）
                </label>
                <label className="ev-mode">
                  <input
                    type="radio"
                    name="ev-trigger-mode"
                    checked={!sel.isTriggeredOnly}
                    onClick={(e) => {
                      if (!e.currentTarget.checked) return
                      mutate((m) => {
                        const ev = findIn(m, sel.id)
                        if (ev) setEventFlag(ev.entry, 'is_triggered_only', false)
                      })
                    }}
                    onChange={() => {}}
                  />
                  条件触发（满足条件且平均时间到达时自动弹出）
                </label>
              </div>

              <div className="fe-section-title">
                国策联动
                <span className="fe-title-note">完成效果里触发了该事件的国策</span>
              </div>
              <div className="fe-loc-box">
                {eventRefs === null ? (
                  <div className="fe-loc-text dim">正在扫描国策文件…</div>
                ) : refs.length === 0 ? (
                  <div className="fe-loc-text dim">没有国策在完成效果里触发该事件</div>
                ) : (
                  refs.map((r) => (
                    <div className="fe-fire-row" key={`${r.fileRel}:${r.focusId}`}>
                      <span className="fe-fire-meta">
                        <code>{r.focusId}</code>
                        <span className="fe-fire-file">{r.fileRel}</span>
                      </span>
                      <button className="btn tiny" onClick={() => onOpenFocus(r.focusId, r.fileRel)}>
                        在国策树中查看
                      </button>
                    </div>
                  ))
                )}
              </div>

              <div className="fe-section-title">条件与效果</div>
              <div className="ev-cond-actions">
                {!sel.isTriggeredOnly && (
                  <>
                    <button className="btn small" onClick={() => openCond('trigger')}>
                      触发条件 {sel.hasTrigger && <span className="ev-dot" />}
                    </button>
                    <button className="btn small" onClick={() => openCond('mean_time_to_happen')}>
                      平均触发时间 {sel.hasMtth && <span className="ev-dot" />}
                    </button>
                  </>
                )}
                <button className="btn small" onClick={() => openCond('immediate')}>
                  立即效果 {sel.hasImmediate && <span className="ev-dot" />}
                </button>
              </div>

              <div className="fe-section-title">
                选项
                <span className="fe-title-note">玩家在弹窗里看到的选择，可带条件与效果</span>
              </div>
              <div className="ev-options">
                {sel.options.map((o, i) => (
                  <div className="ev-opt-row" key={i}>
                    <span className="ev-opt-idx">选项 {i + 1}</span>
                    <input
                      className="text-input ev-opt-name"
                      value={o.name}
                      placeholder="选项名本地化键"
                      title="选项名本地化键"
                      onChange={(e) =>
                        mutate((m) => {
                          const ev = findIn(m, sel.id)
                          if (ev) setOptionName(ev.options[i].entry, e.target.value)
                        })
                      }
                    />
                    <button className="btn tiny" onClick={() => openCond('option_trigger', i)}>
                      显示条件{o.hasTrigger && <span className="ev-dot" />}
                    </button>
                    <button className="btn tiny" onClick={() => openCond('ai_chance', i)}>
                      AI 权重{o.hasAiChance && <span className="ev-dot" />}
                    </button>
                    <button className="btn tiny" onClick={() => openCond('option_effects', i)}>
                      效果{o.hasEffects && <span className="ev-dot" />}
                    </button>
                    <button
                      className="btn tiny"
                      title="删除这个选项（可撤销）"
                      onClick={() => {
                        mutate((m) => {
                          const ev = findIn(m, sel.id)
                          if (ev) deleteOption(ev.options[i].entry)
                        })
                      }}
                    >
                      删除
                    </button>
                  </div>
                ))}
                {sel.options.length === 0 && <div className="ev-options-empty">还没有选项，事件弹出后玩家将无法关闭弹窗，请至少添加一个</div>}
                <button className="btn small" onClick={addNewOption}>
                  ＋ 添加选项
                </button>
              </div>
              <div className="loc-edit-note">Ctrl+Z 撤销 · Ctrl+S 保存 · 保存前自动备份最近 10 份</div>
            </>
          ) : (
            <div className="viewer-empty">
              <p className="viewer-empty-title">选择左侧事件开始编辑</p>
              <p>「＋ 新建事件」会按命名空间自动分配 id，并生成标题/描述键与一个空选项。</p>
            </div>
          )}
          {statusMsg && <div className="loc-status">{statusMsg}</div>}
        </div>
      </div>

      {showPicker && sel && (
        <IconPicker
          sprites={sprites}
          getUrl={getIconUrl}
          current={sel.picture}
          onPick={(name) => {
            mutate((m) => {
              const ev = findIn(m, sel.id)
              if (ev) setEventPicture(ev.entry, name)
            })
            setShowPicker(false)
          }}
          onClose={() => setShowPicker(false)}
        />
      )}

      {condModal && condNodes && (
        <ConditionEditor
          blockKey={condModal.blockKey}
          nodes={condNodes.nodes as import('../../../shared/conditions').CondNode[]}
          newline={nl}
          onApply={(ns) => {
            mutate((m) => {
              const ev = findIn(m, condModal.eventId)
              if (!ev) return
              if (condModal.optIndex !== undefined) {
                const opt = ev.options[condModal.optIndex]
                if (!opt) return
                if (condModal.blockKey === 'option_effects') setOptionEffects(opt.entry, ns, nl)
                else if (condModal.blockKey === 'option_trigger') setEventCondBlock(opt.entry, 'trigger', ns)
                else setEventCondBlock(opt.entry, 'ai_chance', ns)
              } else {
                setEventCondBlock(ev.entry, condModal.blockKey, ns)
              }
            })
            setCondModal(null)
          }}
          onClose={() => setCondModal(null)}
        />
      )}
    </div>
  )
}
