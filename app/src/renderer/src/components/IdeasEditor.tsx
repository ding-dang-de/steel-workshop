import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  loadIdeas,
  saveIdeas,
  buildIdeas,
  setIdeaId,
  setIdeaPicture,
  getIdeaCondBlock,
  setIdeaCondBlock,
  getModifierRows,
  setModifierRow,
  renameModifierRow,
  addCategory,
  deleteCategory,
  addIdea,
  deleteIdea,
  moveIdea,
  suggestIdeaId
} from '../../../shared/ideas'
import type { IdeasModel, IdeaDef, ModifierRow } from '../../../shared/ideas'
import { MOD_CAT_ZH, findModifier, formatModifierValue, suggestModifierKeys } from '../../../shared/modifiers'
import ConditionEditor from './ConditionEditor'
import RefTable, { MOD_REF_ROWS, MOD_REF_CATS } from './RefTable'
import IconPicker from './IconPicker'
import ModKeyInput from './ModKeyInput'
import { useSpriteCatalog } from '../hooks/useSpriteCatalog'
import { useLocIndex } from '../hooks/useLocIndex'

/**
 * 民族精神编辑器（第三期第一块）
 * 左侧按分类分组列出精神，右侧结构化编辑：分类（可跨分类移动）/id/图标/
 * 修饰符行（目录自动补全 + 中文说明 + 百分比换算 + 行尾注释保留 + 增删行）/
 * allowed 条件与 on_add、on_remove 效果块。
 * 本地化：标题键 = 精神 id、描述键 = id_desc，与本地化编辑器联动（缺失一键补全）；
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
  /** 跳转到本地化编辑器（autofill = 缺失键自动补全；精神补全会同时补 id 和 id_desc） */
  onOpenLoc: (key: string, locPath: string, autofill: boolean, keyOnly: boolean) => void
  onSaved: (text: string) => void
  onUnsavedChange: (dirty: boolean) => void
  /** 双栏中本栏是否激活；非激活栏不响应全局快捷键（默认 true，单栏用法不传） */
  active?: boolean
}

// ---------- 主组件 ----------

export default function IdeasEditor({
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
  const modelRef = useRef<IdeasModel | null>(null)
  const historyRef = useRef<{ past: string[]; future: string[] }>({ past: [], future: [] })
  /** 当前模型所基于的内容；保存回流的内容与之一致时跳过重建，保留撤销历史 */
  const loadedContentRef = useRef<string | null>(null)
  const [tick, setTick] = useState(0)
  const [filter, setFilter] = useState('')
  const [selection, setSelection] = useState<string | null>(null)
  /** 结构化编辑弹窗：{ ideaId, blockKey } */
  const [condModal, setCondModal] = useState<{ ideaId: string; blockKey: string } | null>(null)
  const [showPicker, setShowPicker] = useState(false)
  const [showRef, setShowRef] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [saving, setSaving] = useState(false)
  const [statusMsg, setStatusMsg] = useState('')
  const [loadError, setLoadError] = useState('')

  const { sprites, spriteFor, getIconUrl } = useSpriteCatalog(gameDir, modPath)
  const { index: locIndex } = useLocIndex(locFiles)

  /** 大写的模组命名空间（文件夹名），用于建议精神/分类 id，如 PARIS_COMMUNE */
  const nsBase = (modPath.split(/[\\/]/).pop() ?? 'idea').replace(/[^A-Za-z0-9_]/g, '_').toUpperCase()

  useEffect(() => {
    // 保存回流的内容：模型已与之一致，跳过重建（否则撤销历史会被清空）
    if (content === loadedContentRef.current) return
    loadedContentRef.current = content
    const model = loadIdeas(content)
    modelRef.current = model
    historyRef.current = { past: [], future: [] }
    setSelection(model && model.ideas.length > 0 ? model.ideas[0].id : null)
    setLoadError(model ? '' : '无法解析该文件为民族精神文件')
    setStatusMsg('')
    onUnsavedChange(false)
    setTick((t) => t + 1)
  }, [path, content, onUnsavedChange])

  const mutate = useCallback(
    (fn: (m: IdeasModel) => void): void => {
      const m = modelRef.current
      if (!m) return
      historyRef.current = { past: [...historyRef.current.past.slice(-99), saveIdeas(m)], future: [] }
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
    const restored = loadIdeas(prev)
    if (!restored) return
    h.past.pop()
    h.future.unshift(saveIdeas(m))
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
    const restored = loadIdeas(next)
    if (!restored) return
    h.future.shift()
    h.past.push(saveIdeas(m))
    modelRef.current = restored
    onUnsavedChange(true)
    setTick((t) => t + 1)
  }, [onUnsavedChange])

  const save = useCallback(async (): Promise<void> => {
    const m = modelRef.current
    if (!m || saving) return
    setSaving(true)
    try {
      const text = saveIdeas(m)
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
    const model = loadIdeas(content)
    modelRef.current = model
    historyRef.current = { past: [], future: [] }
    setSelection(model && model.ideas.length > 0 ? model.ideas[0].id : null)
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
    () => (modelRef.current ? buildIdeas(modelRef.current.file) : { ideas: [], categories: [] }),
    [tick]
  )
  const ideas = built.ideas
  const categories = built.categories
  const sel = selection !== null ? (ideas.find((d) => d.id === selection) ?? null) : null

  const findIn = (m: IdeasModel, id: string): IdeaDef | null => buildIdeas(m.file).ideas.find((d) => d.id === id) ?? null

  const f = filter.trim().toLowerCase()
  const filteredByCat = (cat: string): IdeaDef[] =>
    ideas.filter(
      (d) => d.category === cat && (!f || d.id.toLowerCase().includes(f) || d.picture.toLowerCase().includes(f))
    )

  // 当前选中精神的修饰符行（每次 tick 重新读，保证与模型一致）
  const modRows = useMemo<ModifierRow[]>(() => (sel ? getModifierRows(sel.entry) : []), [sel, tick])

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

  /** 精神本地化键：标题 = id、描述 = id_desc；补全时两个键一起补 */
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
    const id = suggestIdeaId(m, nsBase)
    mutate((mm) => {
      const cats = buildIdeas(mm.file).categories
      const catName = cats[0] ?? 'country'
      if (cats.length === 0) addCategory(mm, catName)
      addIdea(mm, catName, id)
    })
    setSelection(id)
    setStatusMsg(`已添加精神「${id}」，请到本地化里翻译标题和描述`)
  }

  const addCategoryFromInput = (): void => {
    const name = newCategoryName.trim()
    if (!name) return
    const m = modelRef.current
    if (m && buildIdeas(m.file).categories.includes(name)) {
      setStatusMsg(`分类「${name}」已存在`)
      return
    }
    mutate((mm) => addCategory(mm, name))
    setNewCategoryName('')
    setStatusMsg(`已添加分类「${name}」`)
  }

  const removeSelected = (): void => {
    if (!sel) return
    if (!window.confirm(`确定删除精神「${sel.id}」吗？可以撤销。`)) return
    mutate((m) => deleteIdea(m, sel.id))
    setSelection(null)
  }

  const removeCategory = (cat: string): void => {
    const count = ideas.filter((d) => d.category === cat).length
    if (count > 0) return
    if (!window.confirm(`确定删除空分类「${cat}」吗？可以撤销。`)) return
    mutate((m) => deleteCategory(m, cat))
    setStatusMsg(`已删除分类「${cat}」`)
  }

  const openCond = (blockKey: string): void => {
    if (!sel) return
    setCondModal({ ideaId: sel.id, blockKey })
  }

  /** 条件弹窗当前目标块的节点 */
  const condNodes = useMemo(() => {
    if (!condModal || !sel) return null
    return { nodes: getIdeaCondBlock(sel.entry, condModal.blockKey) ?? [] }
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
          placeholder="搜索精神 id 或图标…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <span className="fe-spacer" />
        <button className="btn small" onClick={addNew}>
          ＋ 新建精神
        </button>
        <input
          className="text-input dc-cat-input"
          placeholder="新分类名…"
          title="新建一个精神分类（如 country / political_advisor / theorist）"
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
          {ideas.length} 个精神 · {categories.length} 个分类
        </span>
      </div>

      <div className="loc-main">
        <div className="loc-list">
          {categories.map((cat) => {
            const ds = filteredByCat(cat)
            const count = ideas.filter((d) => d.category === cat).length
            const catMatch = f && cat.toLowerCase().includes(f)
            // 只在筛选激活且无命中时隐藏；平时空分类也要显示，否则新建的分类会“消失”
            if (f && ds.length === 0 && !catMatch) return null
            const shown = catMatch ? ideas.filter((d) => d.category === cat) : ds
            return (
              <div key={cat}>
                <div className="dc-cat-row">
                  <span className="dc-cat-name" title={cat}>
                    {cat}
                  </span>
                  <span className="dc-cat-count">{count} 个精神</span>
                  <span className="fe-spacer" />
                  <button
                    className="btn tiny dc-cat-del"
                    disabled={count > 0}
                    title={count > 0 ? '分类里还有精神，先移走或删除再删分类' : '删除这个空分类'}
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
                      {d.hasModifier && <span className="loc-badge">带修正</span>}
                    </span>
                    <span className="loc-preview">
                      {d.picture || '（无图标）'} · {locOf(d.id)?.text ?? '（未本地化）'}
                    </span>
                  </button>
                ))}
              </div>
            )
          })}
          {ideas.length === 0 && (
            <div className="loc-list-empty">这个文件还没有民族精神，点右上角「＋ 新建精神」开始（会自动建好第一个分类）</div>
          )}
          {ideas.length > 0 && f && categories.every((cat) => filteredByCat(cat).length === 0) && (
            <div className="loc-list-empty">没有匹配的精神</div>
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
                  删除精神
                </button>
              </div>

              <div className="fe-section-title">基本信息</div>
              <div className="fe-row">
                <label className="fe-field">
                  <span>所属分类</span>
                  <select
                    className="text-input"
                    value={sel.category}
                    title="把精神移到另一个分类块"
                    onChange={(e) =>
                      mutate((m) => {
                        const d = findIn(m, sel.id)
                        if (d) moveIdea(m, d.id, e.target.value)
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
                  <span>精神 id</span>
                  <input
                    className="text-input"
                    value={sel.id}
                    placeholder="如 FRA_general_strike"
                    onChange={(e) => {
                      mutate((m) => {
                        const d = findIn(m, sel.id)
                        if (d) setIdeaId(d.entry, e.target.value)
                      })
                      setSelection(e.target.value || sel.id)
                    }}
                  />
                </label>
              </div>

              <label className="fe-field">
                <span>图标（picture）</span>
                <div className="fe-icon-row">
                  <input
                    className="text-input"
                    value={sel.picture}
                    placeholder="如 generic_communism 或 GFX_idea_xxx"
                    onChange={(e) =>
                      mutate((m) => {
                        const d = findIn(m, sel.id)
                        if (d) setIdeaPicture(d.entry, e.target.value)
                      })
                    }
                  />
                  <button className="btn small" onClick={() => setShowPicker(true)}>
                    选择…
                  </button>
                  {curSpriteUrl && <img className="ev-pic-preview" src={curSpriteUrl} alt="" />}
                </div>
              </label>

              <div className="fe-title-row">
                <div className="fe-section-title">
                  修饰符（modifier）
                  <span className="fe-title-note">输入中/英文搜索补全，带中文说明；% = 游戏内按百分比显示</span>
                </div>
                <button className="btn tiny" disabled={!sel} onClick={() => setShowRef(true)}>
                  📖 对照表
                </button>
              </div>
              <div className="im-mod-list">
                {modRows.map((r) => {
                  const spec = findModifier(r.key)
                  return (
                    <div className="im-mod-row" key={r.key}>
                      <ModKeyInput
                        value={r.key}
                        commitOnBlur
                        onPick={(k) => {
                          mutate((m) => {
                            const d = findIn(m, sel.id)
                            if (d) renameModifierRow(d.entry, r.key, k)
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
                                if (d) setModifierRow(d.entry, r.key, e.target.value)
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
                            if (d) setModifierRow(d.entry, r.key, null)
                          })
                        }
                      >
                        ×
                      </button>
                    </div>
                  )
                })}
                {modRows.length === 0 && <div className="im-mod-empty">这个精神还没有 modifier 块，在下面添加第一个修饰符</div>}
                <div className="im-mod-row im-mod-add">
                  <ModKeyInput
                    key={`im-add-${modRows.length}`}
                    value=""
                    placeholder="＋ 添加修饰符，输入英文搜索…"
                    onPick={(k) => {
                      mutate((m) => {
                        const d = findIn(m, sel.id)
                        if (d) setModifierRow(d.entry, k, '')
                      })
                    }}
                  />
                </div>
              </div>

              <div className="fe-section-title">条件与效果</div>
              <div className="ev-cond-actions">
                {condBtn('allowed', '允许条件', sel.hasAllowed)}
                {condBtn('on_add', '添加时效果', sel.hasOnAdd)}
                {condBtn('on_remove', '移除时效果', sel.hasOnRemove)}
              </div>

              <div className="fe-section-title">
                本地化（名称与描述）
                <span className="fe-title-note">标题键 = 精神 id，描述键 = id_desc，缺失可一键补全</span>
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
              <p className="viewer-empty-title">选择左侧精神开始编辑</p>
              <p>「＋ 新建精神」会按命名空间自动分配 id，并自动建好第一个分类。</p>
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
              const d = findIn(m, sel.id)
              if (d) setIdeaPicture(d.entry, name)
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
              const d = findIn(m, condModal.ideaId)
              if (d) setIdeaCondBlock(d.entry, condModal.blockKey, ns)
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
              if (d) setModifierRow(d.entry, k, '')
            })
            setShowRef(false)
          }}
          onClose={() => setShowRef(false)}
        />
      )}
    </div>
  )
}
