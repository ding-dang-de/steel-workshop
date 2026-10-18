import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  loadTraits,
  saveTraits,
  buildTraits,
  setTraitId,
  setTraitRandom,
  getTraitRows,
  setTraitRow,
  renameTraitRow,
  getTraitCondBlock,
  setTraitCondBlock,
  addTrait,
  deleteTrait,
  suggestTraitId
} from '../../../shared/traits'
import type { TraitsModel, TraitDef, TraitRow } from '../../../shared/traits'
import { findModifier, formatModifierValue, suggestModifierKeys } from '../../../shared/modifiers'
import ConditionEditor from './ConditionEditor'
import RefTable, { MOD_REF_ROWS, MOD_REF_CATS } from './RefTable'
import ModKeyInput from './ModKeyInput'
import { useLocIndex } from '../hooks/useLocIndex'

/**
 * 领导人特质编辑器（第三期·人物 之一）
 * 左侧列出特质，右侧结构化编辑：id / random / 修饰符行（目录自动补全 + 中文说明 +
 * 百分比换算 + 增删行）/ ai_will_do 条件块。
 * 本地化：标题键 = 特质 id、描述键 = id_desc，与本地化编辑器联动（缺失一键补全）；
 * 无损只重写改动条目；撤销/重做/自动备份与其它编辑器同一套机制。
 * （行样式复用民族精神的 .im-mod-* 类，另加 .tm-* 类便于区分编辑器）
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
  onOpenLoc: (key: string, locPath: string, autofill: boolean, keyOnly: boolean) => void
  onSaved: (text: string) => void
  onUnsavedChange: (dirty: boolean) => void
  /** 双栏中本栏是否激活；非激活栏不响应全局快捷键（默认 true，单栏用法不传） */
  active?: boolean
}

export default function TraitsEditor({
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
  const modelRef = useRef<TraitsModel | null>(null)
  const historyRef = useRef<{ past: string[]; future: string[] }>({ past: [], future: [] })
  /** 当前模型所基于的内容；保存回流的内容与之一致时跳过重建，保留撤销历史 */
  const loadedContentRef = useRef<string | null>(null)
  const [tick, setTick] = useState(0)
  const [filter, setFilter] = useState('')
  const [selection, setSelection] = useState<string | null>(null)
  /** 结构化编辑弹窗：{ traitId, blockKey } */
  const [condModal, setCondModal] = useState<{ traitId: string; blockKey: string } | null>(null)
  const [showRef, setShowRef] = useState(false)
  const [saving, setSaving] = useState(false)
  const [statusMsg, setStatusMsg] = useState('')
  const [loadError, setLoadError] = useState('')

  const { index: locIndex } = useLocIndex(locFiles)

  /** 大写的模组命名空间（文件夹名），用于建议特质 id，如 FRA */
  const nsBase = (modPath.split(/[\\/]/).pop() ?? 'trait').replace(/[^A-Za-z0-9_]/g, '_').toUpperCase()

  useEffect(() => {
    // 保存回流的内容：模型已与之一致，跳过重建（否则撤销历史会被清空）
    if (content === loadedContentRef.current) return
    loadedContentRef.current = content
    const model = loadTraits(content)
    modelRef.current = model
    historyRef.current = { past: [], future: [] }
    setSelection(model && model.traits.length > 0 ? model.traits[0].id : null)
    setLoadError(model ? '' : '无法解析该文件为特质文件')
    setStatusMsg('')
    onUnsavedChange(false)
    setTick((t) => t + 1)
  }, [path, content, onUnsavedChange])

  const mutate = useCallback(
    (fn: (m: TraitsModel) => void): void => {
      const m = modelRef.current
      if (!m) return
      historyRef.current = { past: [...historyRef.current.past.slice(-99), saveTraits(m)], future: [] }
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
    const restored = loadTraits(prev)
    if (!restored) return
    h.past.pop()
    h.future.unshift(saveTraits(m))
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
    const restored = loadTraits(next)
    if (!restored) return
    h.future.shift()
    h.past.push(saveTraits(m))
    modelRef.current = restored
    onUnsavedChange(true)
    setTick((t) => t + 1)
  }, [onUnsavedChange])

  const save = useCallback(async (): Promise<void> => {
    const m = modelRef.current
    if (!m || saving) return
    setSaving(true)
    try {
      const text = saveTraits(m)
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
    const model = loadTraits(content)
    modelRef.current = model
    historyRef.current = { past: [], future: [] }
    setSelection(model && model.traits.length > 0 ? model.traits[0].id : null)
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
    () => (modelRef.current ? buildTraits(modelRef.current.file) : []),
    [tick]
  )
  const traits = built
  const sel = selection !== null ? (traits.find((d) => d.id === selection) ?? null) : null

  const findIn = (m: TraitsModel, id: string): TraitDef | null => buildTraits(m.file).find((d) => d.id === id) ?? null

  const f = filter.trim().toLowerCase()
  const filtered = f ? traits.filter((d) => d.id.toLowerCase().includes(f)) : traits

  // 当前选中特质的修饰符行（每次 tick 重新读，保证与模型一致）
  const traitRows = useMemo<TraitRow[]>(() => (sel ? getTraitRows(sel.entry) : []), [sel, tick])

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
    const id = suggestTraitId(m, nsBase)
    mutate((mm) => {
      addTrait(mm, id)
    })
    setSelection(id)
    setStatusMsg(`已添加特质「${id}」，请到本地化里翻译标题和描述`)
  }

  const removeSelected = (): void => {
    if (!sel) return
    if (!window.confirm(`确定删除特质「${sel.id}」吗？可以撤销。`)) return
    mutate((m) => deleteTrait(m, sel.id))
    setSelection(null)
  }

  const openCond = (blockKey: string): void => {
    if (!sel) return
    setCondModal({ traitId: sel.id, blockKey })
  }

  /** 条件弹窗当前目标块的节点 */
  const condNodes = useMemo(() => {
    if (!condModal || !sel) return null
    return { nodes: getTraitCondBlock(sel.entry, condModal.blockKey) ?? [] }
  }, [condModal, sel])

  // ---------- 渲染 ----------

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
    <div className="loc-editor traits-editor">
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
          placeholder="搜索特质 id…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <span className="fe-spacer" />
        <button className="btn small" onClick={addNew}>
          ＋ 新建特质
        </button>
        <span className="loc-stats">{traits.length} 个特质</span>
      </div>

      <div className="loc-main">
        <div className="loc-list">
          {filtered.map((d) => (
            <button
              key={d.id}
              className={selection === d.id ? 'loc-row active' : 'loc-row'}
              onClick={() => setSelection(d.id)}
            >
              <span className="loc-key">{d.id}</span>
              <span className="loc-preview">random = {d.random || '（无）'} · {locOf(d.id)?.text ?? '（未本地化）'}</span>
            </button>
          ))}
          {traits.length === 0 && (
            <div className="loc-list-empty">这个文件还没有特质，点右上角「＋ 新建特质」开始</div>
          )}
          {traits.length > 0 && f && filtered.length === 0 && <div className="loc-list-empty">没有匹配的特质</div>}
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
                  删除特质
                </button>
              </div>

              <div className="fe-section-title">基本信息</div>
              <div className="fe-row">
                <label className="fe-field">
                  <span>特质 id</span>
                  <input
                    className="text-input"
                    value={sel.id}
                    placeholder="如 FRA_marcel_cachin_trait"
                    onChange={(e) => {
                      mutate((m) => {
                        const d = findIn(m, sel.id)
                        if (d) setTraitId(d.entry, e.target.value)
                      })
                      setSelection(e.target.value || sel.id)
                    }}
                  />
                </label>
                <label className="fe-field">
                  <span>random</span>
                  <input
                    className="text-input"
                    value={sel.random}
                    placeholder="no / yes（留空删除该行）"
                    title="特质是否可随机刷给将领；留空会删除 random 行"
                    onChange={(e) =>
                      mutate((m) => {
                        const d = findIn(m, sel.id)
                        if (d) setTraitRandom(d.entry, e.target.value.trim() === '' ? null : e.target.value)
                      })
                    }
                  />
                </label>
              </div>

              <div className="fe-title-row">
                <div className="fe-section-title">
                  修饰符
                  <span className="fe-title-note">输入中/英文搜索补全，带中文说明；% = 游戏内按百分比显示</span>
                </div>
                <button className="btn tiny" disabled={!sel} onClick={() => setShowRef(true)}>
                  📖 对照表
                </button>
              </div>
              <div className="im-mod-list tm-mod-list">
                {traitRows.map((r) => {
                  const spec = findModifier(r.key)
                  return (
                    <div className="im-mod-row tm-mod-row" key={r.key}>
                      <ModKeyInput
                        value={r.key}
                        commitOnBlur
                        onPick={(k) => {
                          mutate((m) => {
                            const d = findIn(m, sel.id)
                            if (d) renameTraitRow(d.entry, r.key, k)
                          })
                        }}
                      />
                      {r.kind === 'scalar' ? (
                        <>
                          <input
                            className="text-input im-mod-val"
                            value={r.text}
                            placeholder="数值，如 0.1"
                            title="修饰符数值；改值时行尾注释原地保留"
                            onChange={(e) =>
                              mutate((m) => {
                                const d = findIn(m, sel.id)
                                if (d) setTraitRow(d.entry, r.key, e.target.value)
                              })
                            }
                          />
                          <span
                            className="im-mod-pct"
                            title={spec?.pct ? '游戏内按百分比显示（0.1 = +10%）' : undefined}
                          >
                            {formatModifierValue(spec, r.text)}
                          </span>
                        </>
                      ) : (
                        <span className="im-mod-block">（嵌套块，请用文本模式编辑）</span>
                      )}
                      <span className="im-mod-zh" title={spec?.note}>
                        {spec ? `${spec.zh}（${spec.cat}）` : '未收录的修饰符，可自由填写'}
                      </span>
                      {r.comment && <span className="im-mod-comment">{r.comment}</span>}
                      <button
                        className="cond-del"
                        title="删除这一行（含行尾注释）"
                        onClick={() =>
                          mutate((m) => {
                            const d = findIn(m, sel.id)
                            if (d) setTraitRow(d.entry, r.key, null)
                          })
                        }
                      >
                        ×
                      </button>
                    </div>
                  )
                })}
                {traitRows.length === 0 && <div className="im-mod-empty">这个特质还没有修饰符，在下面添加第一个修饰符</div>}
                <div className="im-mod-row im-mod-add tm-mod-row">
                  <ModKeyInput
                    key={`tm-add-${traitRows.length}`}
                    value=""
                    placeholder="＋ 添加修饰符，输入英文搜索…"
                    onPick={(k) => {
                      mutate((m) => {
                        const d = findIn(m, sel.id)
                        if (d) setTraitRow(d.entry, k, '')
                      })
                    }}
                  />
                </div>
              </div>

              <div className="fe-section-title">条件与效果</div>
              <div className="ev-cond-actions">
                {condBtn('ai_will_do', 'AI 执行意愿', sel.hasAiWillDo)}
              </div>

              <div className="fe-section-title">
                本地化（名称与描述）
                <span className="fe-title-note">标题键 = 特质 id，描述键 = id_desc，缺失可一键补全</span>
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
              <p className="viewer-empty-title">选择左侧特质开始编辑</p>
              <p>「＋ 新建特质」会按命名空间自动分配 id。</p>
            </div>
          )}
          {statusMsg && <div className="loc-status">{statusMsg}</div>}
        </div>
      </div>

      {condModal && condNodes && (
        <ConditionEditor
          blockKey={condModal.blockKey}
          nodes={condNodes.nodes}
          newline={modelRef.current?.file.newline ?? '\n'}
          onApply={(ns) => {
            mutate((m) => {
              const d = findIn(m, condModal.traitId)
              if (d) setTraitCondBlock(d.entry, condModal.blockKey, ns)
            })
            setCondModal(null)
          }}
          onClose={() => setCondModal(null)}
        />
      )}

      {showRef && (
        <RefTable
          title="修饰符对照表"
          rows={MOD_REF_ROWS}
          cats={MOD_REF_CATS}
          search={suggestModifierKeys}
          onPick={(k) => {
            if (!sel) return
            mutate((m) => {
              const d = findIn(m, sel.id)
              if (d) setTraitRow(d.entry, k, '')
            })
            setShowRef(false)
          }}
          onClose={() => setShowRef(false)}
        />
      )}
    </div>
  )
}
