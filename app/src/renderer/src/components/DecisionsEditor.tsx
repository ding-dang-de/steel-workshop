import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  loadDecisions,
  saveDecisions,
  buildDecisions,
  setDecisionId,
  setDecisionIcon,
  setDecisionCost,
  setDecisionDays,
  setDecisionFlag,
  getDecisionCondBlock,
  setDecisionCondBlock,
  addCategory,
  deleteCategory,
  addDecision,
  deleteDecision,
  suggestDecisionId,
  moveDecision
} from '../../../shared/decisions'
import type { DecisionsModel, DecisionDef } from '../../../shared/decisions'
import ConditionEditor from './ConditionEditor'
import IconPicker from './IconPicker'
import { useSpriteCatalog } from '../hooks/useSpriteCatalog'
import { useLocIndex } from '../hooks/useLocIndex'

/**
 * 决议编辑器（第二期第二块）
 * 左侧按分类分组列出决议，右侧结构化编辑：分类（可跨分类移动）/id/图标/政治点数消耗/
 * 移除与冷却天数/开关（只执行一次、目标决议）/条件与效果块（显示、可用、允许、完成、
 * 移除、AI 意愿、静态修正、目标修正）。
 * 本地化：标题键 = 决议 id、描述键 = id_desc，与本地化编辑器联动（缺失一键补全两个键）；
 * 条件/效果复用结构化编辑器；无损只重写改动条目；撤销/重做/自动备份与其它编辑器同一套机制。
 */

interface Props {
  path: string
  content: string
  gameDir: string | null
  modPath: string
  /** 模组内的本地化文件（标题/描述联动） */
  locFiles: { path: string; rel: string }[]
  /** 模组内全部国策树的国策 id；null 表示正在读取（选本地化文件用） */
  focusIds: string[] | null
  /** 跳转到本地化编辑器（autofill = 缺失键自动补全；决议补全会同时补 id 和 id_desc） */
  onOpenLoc: (key: string, locPath: string, autofill: boolean, keyOnly: boolean) => void
  onSaved: (text: string) => void
  onUnsavedChange: (dirty: boolean) => void
  /** 双栏中本栏是否激活；非激活栏不响应全局快捷键（默认 true，单栏用法不传） */
  active?: boolean
}

export default function DecisionsEditor({
  path,
  content,
  gameDir,
  modPath,
  locFiles,
  focusIds,
  onOpenLoc,
  onSaved,
  onUnsavedChange,
  active
}: Props): React.JSX.Element {
  /** 渲染期赋值让 keydown 闭包始终读到最新激活状态（effect 依赖不变，避免反复挂卸监听） */
  const activeRef = useRef(active ?? true)
  activeRef.current = active ?? true
  const modelRef = useRef<DecisionsModel | null>(null)
  const historyRef = useRef<{ past: string[]; future: string[] }>({ past: [], future: [] })
  /** 当前模型所基于的内容；保存回流的内容与之一致时跳过重建，保留撤销历史 */
  const loadedContentRef = useRef<string | null>(null)
  const [tick, setTick] = useState(0)
  const [filter, setFilter] = useState('')
  const [selection, setSelection] = useState<string | null>(null)
  /** 结构化编辑弹窗：{ decisionId, blockKey } */
  const [condModal, setCondModal] = useState<{ decisionId: string; blockKey: string } | null>(null)
  const [showPicker, setShowPicker] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [saving, setSaving] = useState(false)
  const [statusMsg, setStatusMsg] = useState('')
  const [loadError, setLoadError] = useState('')

  const { sprites, spriteFor, getIconUrl } = useSpriteCatalog(gameDir, modPath)
  const { index: locIndex } = useLocIndex(locFiles)

  /** 大写的模组命名空间（文件夹名），用于建议决议/分类 id，如 PARIS_COMMUNE */
  const nsBase = (modPath.split(/[\\/]/).pop() ?? 'decision').replace(/[^A-Za-z0-9_]/g, '_').toUpperCase()

  useEffect(() => {
    // 保存回流的内容：模型已与之一致，跳过重建（否则撤销历史会被清空）
    if (content === loadedContentRef.current) return
    loadedContentRef.current = content
    const model = loadDecisions(content)
    modelRef.current = model
    historyRef.current = { past: [], future: [] }
    setSelection(model && model.decisions.length > 0 ? model.decisions[0].id : null)
    setLoadError(model ? '' : '无法解析该文件为决议文件')
    setStatusMsg('')
    onUnsavedChange(false)
    setTick((t) => t + 1)
  }, [path, content, onUnsavedChange])

  const mutate = useCallback(
    (fn: (m: DecisionsModel) => void): void => {
      const m = modelRef.current
      if (!m) return
      historyRef.current = { past: [...historyRef.current.past.slice(-99), saveDecisions(m)], future: [] }
      fn(m)
      onUnsavedChange(true)
      setTick((t) => t + 1)
    },
    [onUnsavedChange]
  )

  const undo = useCallback((): void => {
    const m = modelRef.current
    const h = historyRef.current
    if (!m) return
    const prev = h.past[h.past.length - 1]
    if (prev === undefined) return
    const restored = loadDecisions(prev)
    if (!restored) return
    h.past.pop()
    h.future.unshift(saveDecisions(m))
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
    const restored = loadDecisions(next)
    if (!restored) return
    h.future.shift()
    h.past.push(saveDecisions(m))
    modelRef.current = restored
    onUnsavedChange(true)
    setTick((t) => t + 1)
  }, [onUnsavedChange])

  const save = useCallback(async (): Promise<void> => {
    const m = modelRef.current
    if (!m || saving) return
    setSaving(true)
    try {
      const text = saveDecisions(m)
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
    const model = loadDecisions(content)
    modelRef.current = model
    historyRef.current = { past: [], future: [] }
    setSelection(model && model.decisions.length > 0 ? model.decisions[0].id : null)
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

  const built = useMemo(
    () => (modelRef.current ? buildDecisions(modelRef.current.file) : { decisions: [], categories: [] }),
    [tick]
  )
  const decisions = built.decisions
  const categories = built.categories
  const sel = selection !== null ? (decisions.find((d) => d.id === selection) ?? null) : null

  const findIn = (m: DecisionsModel, id: string): DecisionDef | null =>
    buildDecisions(m.file).decisions.find((d) => d.id === id) ?? null

  const f = filter.trim().toLowerCase()
  const filteredByCat = (cat: string): DecisionDef[] =>
    decisions.filter(
      (d) => d.category === cat && (!f || d.id.toLowerCase().includes(f) || d.icon.toLowerCase().includes(f))
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

  /** 决议本地化键：标题 = id、描述 = id_desc；补全时两个键一起补 */
  const descKeyOf = (id: string): string => `${id}_desc`
  const locComplete = (id: string): boolean => !!locOf(id) && !!locOf(descKeyOf(id))

  const jumpLoc = (id: string): void => {
    if (!id) return
    const p = pickLocPath(id)
    if (p) onOpenLoc(id, p, !locComplete(id), false)
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
    const id = suggestDecisionId(m, nsBase)
    mutate((mm) => {
      const cats = buildDecisions(mm.file).categories
      const catName = cats[0] ?? `${nsBase}_decision_category`
      if (cats.length === 0) addCategory(mm, catName)
      addDecision(mm, catName, id)
    })
    setSelection(id)
    setStatusMsg(`已添加决议「${id}」，请到本地化里翻译标题和描述`)
  }

  const addCategoryFromInput = (): void => {
    const name = newCategoryName.trim()
    if (!name) return
    const m = modelRef.current
    if (m && buildDecisions(m.file).categories.includes(name)) {
      setStatusMsg(`分类「${name}」已存在`)
      return
    }
    mutate((mm) => addCategory(mm, name))
    setNewCategoryName('')
    setStatusMsg(`已添加分类「${name}」`)
  }

  const removeSelected = (): void => {
    if (!sel) return
    if (!window.confirm(`确定删除决议「${sel.id}」吗？可以撤销。`)) return
    mutate((m) => deleteDecision(m, sel.id))
    setSelection(null)
  }

  const removeCategory = (cat: string): void => {
    const count = decisions.filter((d) => d.category === cat).length
    if (count > 0) return
    if (!window.confirm(`确定删除空分类「${cat}」吗？可以撤销。`)) return
    mutate((m) => deleteCategory(m, cat))
    setStatusMsg(`已删除分类「${cat}」`)
  }

  const openCond = (blockKey: string): void => {
    if (!sel) return
    setCondModal({ decisionId: sel.id, blockKey })
  }

  /** 条件弹窗当前目标块的节点 */
  const condNodes = useMemo(() => {
    if (!condModal || !sel) return null
    return { nodes: getDecisionCondBlock(sel.entry, condModal.blockKey) ?? [] }
  }, [condModal, sel])

  // ---------- 渲染 ----------

  const curSprite = sel ? spriteFor(sel.icon) : undefined
  const curSpriteUrl = curSprite ? getIconUrl(curSprite) : null

  if (loadError && !modelRef.current) {
    return (
      <div className="viewer-empty">
        <p>{loadError}</p>
        <p className="viewer-empty-note">请切换到「文本」模式查看原始内容。</p>
      </div>
    )
  }

  const condBtn = (key: string, label: string, has: boolean): React.JSX.Element => (
    <button className="btn small" onClick={() => openCond(key)}>
      {label} {has && <span className="ev-dot" />}
    </button>
  )

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
        <input
          className="text-input loc-filter"
          placeholder="搜索决议 id 或图标…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <span className="fe-spacer" />
        <button className="btn small" onClick={addNew}>
          ＋ 新建决议
        </button>
        <input
          className="text-input dc-cat-input"
          placeholder="新分类名…"
          title="新建一个决议分类（如 FRA_diplomatic_category）"
          value={newCategoryName}
          onChange={(e) => setNewCategoryName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') addCategoryFromInput()
          }}
        />
        <button className="btn small" disabled={!newCategoryName.trim()} onClick={addCategoryFromInput}>
          ＋ 分类
        </button>
        <span className="loc-stats">
          {decisions.length} 个决议 · {categories.length} 个分类
        </span>
      </div>

      <div className="loc-main">
        <div className="loc-list">
          {categories.map((cat) => {
            const ds = filteredByCat(cat)
            const count = decisions.filter((d) => d.category === cat).length
            const catMatch = f && cat.toLowerCase().includes(f)
            // 只在筛选激活且无命中时隐藏；平时空分类也要显示，否则新建的分类会“消失”
            if (f && ds.length === 0 && !catMatch) return null
            const shown = catMatch ? decisions.filter((d) => d.category === cat) : ds
            return (
              <div key={cat}>
                <div className="dc-cat-row">
                  <span className="dc-cat-name" title={cat}>
                    {cat}
                  </span>
                  <span className="dc-cat-count">{count} 个决议</span>
                  <span className="fe-spacer" />
                  <button
                    className="btn tiny dc-cat-del"
                    disabled={count > 0}
                    title={count > 0 ? '分类里还有决议，先移走或删除再删分类' : '删除这个空分类'}
                    onClick={() => removeCategory(cat)}
                  >
                    删除分类
                  </button>
                </div>
                {shown.map((d) => (
                  <button
                    key={d.id}
                    className={selection === d.id ? 'loc-row active' : 'loc-row'}
                    onClick={() => setSelection(d.id)}
                  >
                    <span className="loc-key">
                      {d.id}
                      {d.fireOnlyOnce && <span className="loc-badge">只执行一次</span>}
                      {d.isTargeted && <span className="loc-badge">目标决议</span>}
                    </span>
                    <span className="loc-preview">
                      {d.icon || '（无图标）'} · 消耗 {d.cost || '—'} · {locOf(d.id)?.text ?? '（未本地化）'}
                    </span>
                  </button>
                ))}
              </div>
            )
          })}
          {decisions.length === 0 && (
            <div className="loc-list-empty">这个文件还没有决议，点右上角「＋ 新建决议」开始（会自动建好第一个分类）</div>
          )}
          {decisions.length > 0 && f && categories.every((cat) => filteredByCat(cat).length === 0) && (
            <div className="loc-list-empty">没有匹配的决议</div>
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
                  删除决议
                </button>
              </div>

              <div className="fe-section-title">基本信息</div>
              <div className="fe-row">
                <label className="fe-field">
                  <span>所属分类</span>
                  <select
                    className="text-input"
                    value={sel.category}
                    title="把决议移到另一个分类块"
                    onChange={(e) =>
                      mutate((m) => {
                        const d = findIn(m, sel.id)
                        if (d) moveDecision(m, d.id, e.target.value)
                      })
                    }
                  >
                    {categories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="fe-field">
                  <span>决议 id</span>
                  <input
                    className="text-input"
                    value={sel.id}
                    placeholder="如 FRA_pull_belgium"
                    onChange={(e) => {
                      mutate((m) => {
                        const d = findIn(m, sel.id)
                        if (d) setDecisionId(d.entry, e.target.value)
                      })
                      setSelection(e.target.value || sel.id)
                    }}
                  />
                </label>
              </div>

              <label className="fe-field">
                <span>图标（icon）</span>
                <div className="fe-icon-row">
                  <input
                    className="text-input"
                    value={sel.icon}
                    placeholder="如 generic_decision 或 GFX_decision_xxx"
                    onChange={(e) =>
                      mutate((m) => {
                        const d = findIn(m, sel.id)
                        if (d) setDecisionIcon(d.entry, e.target.value)
                      })
                    }
                  />
                  <button className="btn small" onClick={() => setShowPicker(true)}>
                    选择…
                  </button>
                  {curSpriteUrl && <img className="ev-pic-preview" src={curSpriteUrl} alt="" />}
                </div>
              </label>

              <div className="fe-row">
                <label className="fe-field">
                  <span>政治点数消耗（cost）</span>
                  <input
                    className="text-input"
                    value={sel.cost}
                    placeholder="如 50"
                    onChange={(e) =>
                      mutate((m) => {
                        const d = findIn(m, sel.id)
                        if (d) setDecisionCost(d.entry, e.target.value)
                      })
                    }
                  />
                </label>
                <label className="fe-field">
                  <span>移除天数（days_remove）</span>
                  <input
                    className="text-input"
                    value={sel.daysRemove}
                    placeholder="执行后多少天移除决议"
                    onChange={(e) =>
                      mutate((m) => {
                        const d = findIn(m, sel.id)
                        if (d) setDecisionDays(d.entry, 'days_remove', e.target.value)
                      })
                    }
                  />
                </label>
                <label className="fe-field">
                  <span>冷却天数（days_re_enable）</span>
                  <input
                    className="text-input"
                    value={sel.daysReEnable}
                    placeholder="多少天后可以再次执行"
                    onChange={(e) =>
                      mutate((m) => {
                        const d = findIn(m, sel.id)
                        if (d) setDecisionDays(d.entry, 'days_re_enable', e.target.value)
                      })
                    }
                  />
                </label>
              </div>

              <div className="fe-row ev-flags">
                <label className="ev-check">
                  <input
                    type="checkbox"
                    checked={sel.fireOnlyOnce}
                    onChange={(e) =>
                      mutate((m) => {
                        const d = findIn(m, sel.id)
                        if (d) setDecisionFlag(d.entry, 'fire_only_once', e.target.checked)
                      })
                    }
                  />
                  只执行一次
                </label>
                <label className="ev-check">
                  <input
                    type="checkbox"
                    checked={sel.isTargeted}
                    onChange={(e) =>
                      mutate((m) => {
                        const d = findIn(m, sel.id)
                        if (d) setDecisionFlag(d.entry, 'targeted', e.target.checked)
                      })
                    }
                  />
                  目标决议（对州/国家生效）
                </label>
              </div>

              <div className="fe-section-title">条件与效果</div>
              <div className="ev-cond-actions">
                {condBtn('visible', '显示条件', sel.hasVisible)}
                {condBtn('available', '可用条件', sel.hasAvailable)}
                {condBtn('allowed', '允许条件', sel.hasAllowed)}
                {condBtn('complete_effect', '完成效果', sel.hasCompleteEffect)}
                {condBtn('remove_effect', '移除效果', sel.hasRemoveEffect)}
                {condBtn('ai_will_do', 'AI 意愿', sel.hasAiWillDo)}
                {condBtn('modifier', '静态修正', sel.hasModifier)}
                {condBtn('targeted_modifier', '目标修正', sel.hasTargetedModifier)}
              </div>

              <div className="fe-section-title">
                本地化（名称与描述）
                <span className="fe-title-note">标题键 = 决议 id，描述键 = id_desc，缺失可一键补全</span>
              </div>
              <div className="fe-loc-box">
                {locIndex === null ? (
                  <div className="fe-loc-text dim">正在读取本地化文件…</div>
                ) : locFiles.length === 0 ? (
                  <div className="fe-loc-text dim">模组里没有 localisation 文件</div>
                ) : (
                  <>
                    <div className="fe-loc-status">
                      标题（{sel.id}） {locBadge(sel.id)}
                    </div>
                    <div className="fe-loc-text">{locOf(sel.id)?.text ?? '（本地化文件中没有该键）'}</div>
                    <div className="fe-loc-status">
                      描述（{descKeyOf(sel.id)}） {locBadge(descKeyOf(sel.id))}
                    </div>
                    <div className="fe-loc-text">{locOf(descKeyOf(sel.id))?.text ?? '（本地化文件中没有该键）'}</div>
                    <div className="fe-loc-actions">
                      <button
                        className="btn small primary"
                        disabled={locIndex === null || focusIds === null}
                        onClick={() => jumpLoc(sel.id)}
                      >
                        {locComplete(sel.id) ? '编辑本地化' : '补全并编辑本地化'}
                      </button>
                    </div>
                  </>
                )}
              </div>
              <div className="loc-edit-note">Ctrl+Z 撤销 · Ctrl+S 保存 · 保存前自动备份最近 10 份</div>
            </>
          ) : (
            <div className="viewer-empty">
              <p className="viewer-empty-title">选择左侧决议开始编辑</p>
              <p>「＋ 新建决议」会按命名空间自动分配 id，并自动建好第一个分类。</p>
            </div>
          )}
          {statusMsg && <div className="loc-status">{statusMsg}</div>}
        </div>
      </div>

      {showPicker && sel && (
        <IconPicker
          sprites={sprites}
          getUrl={getIconUrl}
          current={sel.icon}
          onPick={(name) => {
            mutate((m) => {
              const d = findIn(m, sel.id)
              if (d) setDecisionIcon(d.entry, name)
            })
            setShowPicker(false)
          }}
          onClose={() => setShowPicker(false)}
        />
      )}

      {condModal && condNodes && (
        <ConditionEditor
          blockKey={condModal.blockKey}
          nodes={condNodes.nodes}
          newline={modelRef.current?.file.newline ?? '\n'}
          onApply={(ns) => {
            mutate((m) => {
              const d = findIn(m, condModal.decisionId)
              if (d) setDecisionCondBlock(d.entry, condModal.blockKey, ns)
            })
            setCondModal(null)
          }}
          onClose={() => setCondModal(null)}
        />
      )}
    </div>
  )
}
