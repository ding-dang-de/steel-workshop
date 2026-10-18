import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  loadCharacters,
  saveCharacters,
  buildCharacters,
  ROLE_KEYS,
  setCharacterId,
  setName,
  setPortrait,
  addPortraitGroup,
  setRoleField,
  getRoleField,
  getTraitList,
  addTrait,
  removeTrait,
  getCharacterCondBlock,
  setCharacterCondBlock,
  addRoleBlock,
  removeRoleBlock,
  addCharacter,
  deleteCharacter,
  suggestCharacterId
} from '../../../shared/characters'
import type { CharactersModel, CharacterDef, RoleKey } from '../../../shared/characters'
import { hasCjk } from '../../../shared/cjk'
import ConditionEditor from './ConditionEditor'
import IconPicker from './IconPicker'
import { useSpriteCatalog } from '../hooks/useSpriteCatalog'
import { useLocIndex } from '../hooks/useLocIndex'

/**
 * 人物编辑器（第三期·人物）
 * 左侧列出角色（带职位徽标），右侧结构化编辑：id / name（本地化键）/ 肖像组
 * （civilian·army·navy × small·large，图标选择器 + 增删组）/ 职位块
 * （country_leader：ideology·expire·traits；field_marshal：五维技能·traits；
 * advisor：slot·idea_token·allowed·available·ai_will_do·traits）。
 * traits 列表带自动补全（来源：模组 common/country_leader/ 下全部特质 id）；
 * 本地化联动：键 = name 字段；无损只重写改动条目；撤销/重做/自动备份同一套机制。
 */

interface Props {
  path: string
  content: string
  gameDir: string | null
  modPath: string
  /** 模组内的本地化文件（名称联动） */
  locFiles: { path: string; rel: string }[]
  /** 模组内全部国策树的国策 id；null 表示正在读取（选本地化文件用） */
  focusIds: string[] | null
  /** 模组内全部领导人特质 id（traits 自动补全；null 表示正在读取） */
  traitIds: string[] | null
  onOpenLoc: (key: string, locPath: string, autofill: boolean, keyOnly: boolean) => void
  onSaved: (text: string) => void
  onUnsavedChange: (dirty: boolean) => void
  /** 双栏中本栏是否激活；非激活栏不响应全局快捷键（默认 true，单栏用法不传） */
  active?: boolean
}

/** 特质 id 自动补全输入（过滤模组内特质 id；Enter 选中、失焦提交已输入文本） */
function TraitInput({
  value,
  onPick,
  placeholder,
  traitIds,
  remountKey
}: {
  value: string
  onPick: (key: string) => void
  placeholder?: string
  traitIds: string[] | null
  remountKey?: string
}): React.JSX.Element {
  const [text, setText] = useState(value)
  const [open, setOpen] = useState(false)
  const [sel, setSel] = useState(0)

  useEffect(() => {
    setText(value)
  }, [value, remountKey])

  const matches = useMemo(() => {
    const q = text.trim().toLowerCase()
    if (!q || !traitIds) return []
    return traitIds.filter((t) => t.toLowerCase().includes(q)).slice(0, 10)
  }, [text, traitIds])
  // 特质 id 只有英文：中文只作查询（无匹配时提示），永远不会被提交成特质 id
  const cjk = hasCjk(text)
  const blocked = cjk && text.trim() !== '' && matches.length === 0

  useEffect(() => {
    setSel(0)
  }, [matches.length])

  const pick = (key: string): void => {
    setText('')
    setOpen(false)
    onPick(key)
  }

  return (
    <div className="im-key-box tr-key-box">
      <input
        className="text-input tr-key"
        value={text}
        placeholder={placeholder ?? '＋ 添加特质，输入英文…'}
        onChange={(e) => {
          setText(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setTimeout(() => setOpen(false), 150)
          const t = text.trim()
          if (t && !hasCjk(t)) pick(t)
          else if (hasCjk(t) && text !== value) setText(value)
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
            if (matches[sel]) pick(matches[sel])
            else if (text.trim() && !cjk) pick(text.trim())
          } else if (e.key === 'Escape') {
            setOpen(false)
          }
        }}
      />
      {open && (matches.length > 0 || blocked) && (
        <div className="im-drop">
          {matches.map((t, i) => (
            <div
              key={t}
              className={i === sel ? 'im-drop-item sel' : 'im-drop-item'}
              onMouseDown={(e) => {
                e.preventDefault()
                pick(t)
              }}
              onMouseEnter={() => setSel(i)}
            >
              <span className="im-drop-key">{t}</span>
            </div>
          ))}
          {blocked && <div className="drop-note">特质 id 是英文的；中文不会被写成特质 id，请输入英文</div>}
        </div>
      )}
    </div>
  )
}

/** 职位中文名（左侧徽标） */
const ROLE_ZH: Record<RoleKey, string> = {
  country_leader: '国家领袖',
  field_marshal: '陆军元帅',
  corps_commander: '军团指挥官',
  advisor: '顾问',
  unit_leader: '单位将领'
}

/** 各职位的标量字段（右侧表单） */
const ROLE_FIELDS: Record<RoleKey, { key: string; zh: string; placeholder?: string }[]> = {
  country_leader: [
    { key: 'ideology', zh: '意识形态', placeholder: '如 leninism / communism' },
    { key: 'expire', zh: '卸任日期', placeholder: '如 1965.1.1.1' }
  ],
  field_marshal: [
    { key: 'skill', zh: '技能' },
    { key: 'attack_skill', zh: '进攻' },
    { key: 'defense_skill', zh: '防御' },
    { key: 'planning_skill', zh: '计划' },
    { key: 'logistics_skill', zh: '后勤' }
  ],
  corps_commander: [],
  advisor: [
    { key: 'slot', zh: '槽位', placeholder: '如 political_advisor' },
    { key: 'idea_token', zh: '精神 id', placeholder: '关联的民族精神 id' },
    { key: 'cost', zh: '花费', placeholder: '启用所需政治点数' }
  ],
  unit_leader: []
}

/** 顾问的条件/效果块按钮 */
const ADVISOR_CONDS: { key: string; zh: string }[] = [
  { key: 'allowed', zh: '允许条件' },
  { key: 'available', zh: '可用条件' },
  { key: 'ai_will_do', zh: 'AI 执行意愿' },
  { key: 'visible', zh: '显示条件' }
]

export default function CharactersEditor({
  path,
  content,
  gameDir,
  modPath,
  locFiles,
  focusIds,
  traitIds,
  onOpenLoc,
  onSaved,
  onUnsavedChange,
  active
}: Props): React.JSX.Element {
  /** 渲染期赋值让 keydown 闭包始终读到最新激活状态（effect 依赖不变，避免反复挂卸监听） */
  const activeRef = useRef(active ?? true)
  activeRef.current = active ?? true
  const modelRef = useRef<CharactersModel | null>(null)
  const historyRef = useRef<{ past: string[]; future: string[] }>({ past: [], future: [] })
  /** 当前模型所基于的内容；保存回流的内容与之一致时跳过重建，保留撤销历史 */
  const loadedContentRef = useRef<string | null>(null)
  const [tick, setTick] = useState(0)
  const [filter, setFilter] = useState('')
  const [selection, setSelection] = useState<string | null>(null)
  /** 结构化编辑弹窗：{ charId, blockKey } */
  const [condModal, setCondModal] = useState<{ charId: string; blockKey: string } | null>(null)
  /** 正在用图标选择器编辑的肖像槽：{ scope, size } */
  const [pickerSlot, setPickerSlot] = useState<{ scope: string; size: 'small' | 'large' } | null>(null)
  const [newGroupScope, setNewGroupScope] = useState('civilian')
  const [newRoleKey, setNewRoleKey] = useState<RoleKey>('country_leader')
  const [saving, setSaving] = useState(false)
  const [statusMsg, setStatusMsg] = useState('')
  const [loadError, setLoadError] = useState('')

  const { sprites, spriteFor, getIconUrl } = useSpriteCatalog(gameDir, modPath)
  const { index: locIndex } = useLocIndex(locFiles)

  /** 大写的模组命名空间（文件夹名），用于建议角色 id，如 FRA */
  const nsBase = (modPath.split(/[\\/]/).pop() ?? 'character').replace(/[^A-Za-z0-9_]/g, '_').toUpperCase()

  useEffect(() => {
    // 保存回流的内容：模型已与之一致，跳过重建（否则撤销历史会被清空）
    if (content === loadedContentRef.current) return
    loadedContentRef.current = content
    const model = loadCharacters(content)
    modelRef.current = model
    historyRef.current = { past: [], future: [] }
    setSelection(model && model.characters.length > 0 ? model.characters[0].id : null)
    setLoadError(model ? '' : '无法解析该文件为人物文件')
    setStatusMsg('')
    onUnsavedChange(false)
    setTick((t) => t + 1)
  }, [path, content, onUnsavedChange])

  const mutate = useCallback(
    (fn: (m: CharactersModel) => void): void => {
      const m = modelRef.current
      if (!m) return
      historyRef.current = { past: [...historyRef.current.past.slice(-99), saveCharacters(m)], future: [] }
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
    const restored = loadCharacters(prev)
    if (!restored) return
    h.past.pop()
    h.future.unshift(saveCharacters(m))
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
    const restored = loadCharacters(next)
    if (!restored) return
    h.future.shift()
    h.past.push(saveCharacters(m))
    modelRef.current = restored
    onUnsavedChange(true)
    setTick((t) => t + 1)
  }, [onUnsavedChange])

  const save = useCallback(async (): Promise<void> => {
    const m = modelRef.current
    if (!m || saving) return
    setSaving(true)
    try {
      const text = saveCharacters(m)
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
    const model = loadCharacters(content)
    modelRef.current = model
    historyRef.current = { past: [], future: [] }
    setSelection(model && model.characters.length > 0 ? model.characters[0].id : null)
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
    () => (modelRef.current ? buildCharacters(modelRef.current.file) : []),
    [tick]
  )
  const characters = built
  const sel = selection !== null ? (characters.find((d) => d.id === selection) ?? null) : null

  const findIn = (m: CharactersModel, id: string): CharacterDef | null =>
    buildCharacters(m.file).find((d) => d.id === id) ?? null

  const f = filter.trim().toLowerCase()
  const filtered = f ? characters.filter((d) => d.id.toLowerCase().includes(f) || d.name.toLowerCase().includes(f)) : characters

  // 当前选中角色的 traits 列表（每次 tick 重新读，保证与模型一致）
  const traitList = useMemo<string[]>(() => (sel ? getTraitList(sel.entry) : []), [sel, tick])

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

  /** 角色本地化键 = name 字段（通常与 id 相同） */
  const locKeyOf = (d: CharacterDef): string => d.name || d.id

  const jumpLoc = (key: string): void => {
    if (!key) return
    const p = pickLocPath(key)
    // keyOnly：人物只有 name 键，不需要补 id_desc
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
    const id = suggestCharacterId(m, nsBase)
    mutate((mm) => {
      addCharacter(mm, id)
    })
    setSelection(id)
    setStatusMsg(`已添加角色「${id}」，请到本地化里翻译名字`)
  }

  const removeSelected = (): void => {
    if (!sel) return
    if (!window.confirm(`确定删除角色「${sel.id}」吗？可以撤销。`)) return
    mutate((m) => deleteCharacter(m, sel.id))
    setSelection(null)
  }

  const openCond = (blockKey: string): void => {
    if (!sel) return
    setCondModal({ charId: sel.id, blockKey })
  }

  /** 条件弹窗当前目标块的节点 */
  const condNodes = useMemo(() => {
    if (!condModal || !sel) return null
    return { nodes: getCharacterCondBlock(sel.entry, condModal.blockKey) ?? [] }
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

  const condBtn = (key: string, label: string): React.JSX.Element => (
    <button className="btn small" onClick={() => openCond(key)}>
      {label} {sel && getCharacterCondBlock(sel.entry, key) !== null && <span className="ev-dot" />}
    </button>
  )

  /** 单张肖像槽行：值输入 + 图标选择 + 删除 */
  const portraitSlotRow = (group: { scope: string; small: string | null; large: string | null }, size: 'small' | 'large', text: string | null): React.JSX.Element => {
    const sprite = text ? spriteFor(text) : undefined
    const url = sprite ? getIconUrl(sprite) : null
    return (
      <div className="cp-slot-row">
        <span className="cp-slot-size">{size}</span>
        <input
          className="text-input cp-slot-val"
          value={text ?? ''}
          placeholder={size === 'large' ? '如 GFX_portrait_xxx' : '如 GFX_idea_xxx'}
          title="肖像精灵名；清空这一格会删除它"
          onChange={(e) => {
            const v = e.target.value
            mutate((m) => {
              const d = findIn(m, sel!.id)
              if (d) setPortrait(d.entry, group.scope, size, v === '' ? null : v)
            })
          }}
        />
        <button className="btn small" onClick={() => setPickerSlot({ scope: group.scope, size })}>
          选择…
        </button>
        {url && <img className="ev-pic-preview" src={url} alt="" />}
        <button
          className="cond-del"
          title="删除这一格"
          onClick={() =>
            mutate((m) => {
              const d = findIn(m, sel!.id)
              if (d) setPortrait(d.entry, group.scope, size, null)
            })
          }
        >
          ×
        </button>
      </div>
    )
  }

  return (
    <div className="loc-editor char-editor">
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
          placeholder="搜索角色 id 或 name…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <span className="fe-spacer" />
        <button className="btn small" onClick={addNew}>
          ＋ 新建角色
        </button>
        <span className="loc-stats">{characters.length} 个角色</span>
      </div>

      <div className="loc-main">
        <div className="loc-list">
          {filtered.map((d) => (
            <button
              key={d.id}
              className={selection === d.id ? 'loc-row active' : 'loc-row'}
              onClick={() => setSelection(d.id)}
            >
              <span className="loc-key">
                {d.id}
                <span className="chr-role-badge">{d.role === 'none' ? '无职位' : ROLE_ZH[d.role]}</span>
              </span>
              <span className="loc-preview">{d.name !== d.id ? `${d.name} · ` : ''}{locOf(locKeyOf(d))?.text ?? '（未本地化）'}</span>
            </button>
          ))}
          {characters.length === 0 && (
            <div className="loc-list-empty">这个文件还没有角色，点右上角「＋ 新建角色」开始</div>
          )}
          {characters.length > 0 && f && filtered.length === 0 && <div className="loc-list-empty">没有匹配的角色</div>}
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
                  删除角色
                </button>
              </div>

              <div className="fe-section-title">基本信息</div>
              <div className="fe-row">
                <label className="fe-field">
                  <span>角色 id</span>
                  <input
                    className="text-input"
                    value={sel.id}
                    placeholder="如 FRA_Marcel_Cachin"
                    onChange={(e) => {
                      mutate((m) => {
                        const d = findIn(m, sel.id)
                        if (d) setCharacterId(d.entry, e.target.value)
                      })
                      setSelection(e.target.value || sel.id)
                    }}
                  />
                </label>
                <label className="fe-field">
                  <span>name（本地化键）</span>
                  <input
                    className="text-input"
                    value={sel.name}
                    placeholder="通常与角色 id 相同"
                    onChange={(e) =>
                      mutate((m) => {
                        const d = findIn(m, sel.id)
                        if (d) setName(d.entry, e.target.value)
                      })
                    }
                  />
                </label>
              </div>

              <div className="fe-section-title">
                肖像（portraits）
                <span className="fe-title-note">civilian = 政客头像 · army = 将领头像 · navy = 海军将领</span>
              </div>
              <div className="cp-portraits">
                {sel.portraits.length === 0 && (
                  <div className="im-mod-empty">这个角色还没有肖像组，在下面添加一个</div>
                )}
                {sel.portraits.map((g) => (
                  <div className="cp-group" key={g.scope}>
                    <div className="cp-group-head">
                      <span className="cp-group-name" title={g.scope}>
                        {g.scope}
                      </span>
                    </div>
                    {portraitSlotRow(g, 'small', g.small)}
                    {portraitSlotRow(g, 'large', g.large)}
                  </div>
                ))}
                <div className="cp-group-add">
                  <select className="text-input" value={newGroupScope} onChange={(e) => setNewGroupScope(e.target.value)}>
                    <option value="civilian">civilian（政客）</option>
                    <option value="army">army（陆军）</option>
                    <option value="navy">navy（海军）</option>
                  </select>
                  <button
                    className="btn small"
                    onClick={() =>
                      mutate((m) => {
                        const d = findIn(m, sel.id)
                        if (d) addPortraitGroup(d.entry, newGroupScope)
                      })
                    }
                  >
                    ＋ 添加肖像组
                  </button>
                </div>
              </div>

              <div className="fe-section-title">
                职位
                <span className="fe-title-note">职位块类型请在文本模式更改；这里编辑职位字段</span>
              </div>
              {sel.role === 'none' ? (
                <div className="cp-role-empty">
                  <div className="im-mod-empty">这个角色没有职位块（country_leader / field_marshal / advisor）</div>
                  <div className="cp-group-add">
                    <select className="text-input" value={newRoleKey} onChange={(e) => setNewRoleKey(e.target.value as RoleKey)}>
                      {(ROLE_KEYS as readonly RoleKey[]).map((r) => (
                        <option key={r} value={r}>
                          {r}（{ROLE_ZH[r]}）
                        </option>
                      ))}
                    </select>
                    <button
                      className="btn small"
                      onClick={() =>
                        mutate((m) => {
                          const d = findIn(m, sel.id)
                          if (d) addRoleBlock(d.entry, newRoleKey)
                        })
                      }
                    >
                      ＋ 添加职位块
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="cp-role-title">
                    {sel.role}（{ROLE_ZH[sel.role]}）
                    <button
                      className="btn tiny"
                      title="删除这个职位块（可以撤销）"
                      onClick={() =>
                        mutate((m) => {
                          const d = findIn(m, sel.id)
                          if (d) removeRoleBlock(d.entry)
                        })
                      }
                    >
                      删除职位块
                    </button>
                  </div>
                  <div className="fe-row cp-role-fields">
                    {ROLE_FIELDS[sel.role].map((fd) => (
                      <label className="fe-field" key={fd.key}>
                        <span>{fd.zh}（{fd.key}）</span>
                        <input
                          className="text-input"
                          value={getRoleField(sel.entry, fd.key) ?? ''}
                          placeholder={fd.placeholder ?? `数值，如 1`}
                          onChange={(e) =>
                            mutate((m) => {
                              const d = findIn(m, sel.id)
                              if (d) setRoleField(d.entry, fd.key, e.target.value)
                            })
                          }
                        />
                      </label>
                    ))}
                  </div>
                  <div className="fe-section-title">
                    特质（traits）
                    <span className="fe-title-note">特质定义在 common/country_leader/，自动补全来自模组内全部特质文件</span>
                  </div>
                  <div className="cp-traits">
                    <div className="cp-trait-chips">
                      {traitList.map((t) => (
                        <span className="cp-trait-chip" key={t}>
                          {t}
                          <button
                            className="cond-del"
                            title={`移除特质 ${t}`}
                            onClick={() =>
                              mutate((m) => {
                                const d = findIn(m, sel.id)
                                if (d) removeTrait(d.entry, t)
                              })
                            }
                          >
                            ×
                          </button>
                        </span>
                      ))}
                      {traitList.length === 0 && <span className="cp-trait-empty">还没有特质</span>}
                    </div>
                    <TraitInput
                      key={`tr-add-${traitList.length}`}
                      value=""
                      traitIds={traitIds}
                      onPick={(t) => {
                        mutate((m) => {
                          const d = findIn(m, sel.id)
                          if (d) addTrait(d.entry, t)
                        })
                      }}
                    />
                  </div>
                  {sel.role === 'advisor' && (
                    <>
                      <div className="fe-section-title">条件与效果</div>
                      <div className="ev-cond-actions">
                        {ADVISOR_CONDS.map((c) => condBtn(c.key, c.zh))}
                      </div>
                    </>
                  )}
                </>
              )}

              <div className="fe-section-title">
                本地化（名字）
                <span className="fe-title-note">键 = name 字段，缺失可一键补全</span>
              </div>
              <div className="fe-loc-box">
                {locIndex === null ? (
                  <div className="fe-loc-text dim">正在读取本地化文件…</div>
                ) : locFiles.length === 0 ? (
                  <div className="fe-loc-text dim">模组里没有 localisation 文件</div>
                ) : (
                  <>
                    <div className="fe-loc-status">
                      {locKeyOf(sel)} {locBadge(locKeyOf(sel))}
                    </div>
                    <div className="fe-loc-text">{locOf(locKeyOf(sel))?.text ?? '（本地化文件中没有该键）'}</div>
                    <div className="fe-loc-actions">
                      <button
                        className="btn small primary"
                        disabled={locIndex === null || focusIds === null}
                        onClick={() => jumpLoc(locKeyOf(sel))}
                      >
                        {locOf(locKeyOf(sel)) ? '编辑本地化' : '补全并编辑本地化'}
                      </button>
                    </div>
                  </>
                )}
              </div>
              <div className="loc-edit-note">Ctrl+Z 撤销 · Ctrl+S 保存 · 保存前自动备份最近 10 份</div>
            </>
          ) : (
            <div className="viewer-empty">
              <p className="viewer-empty-title">选择左侧角色开始编辑</p>
              <p>「＋ 新建角色」会按命名空间自动分配 id，并建好 civilian 肖像与国家领袖职位。</p>
            </div>
          )}
          {statusMsg && <div className="loc-status">{statusMsg}</div>}
        </div>
      </div>

      {pickerSlot && sel && (
        <IconPicker
          sprites={sprites}
          getUrl={getIconUrl}
          current={sel.portraits.find((g) => g.scope === pickerSlot.scope)?.[pickerSlot.size] ?? ''}
          onPick={(name) => {
            mutate((m) => {
              const d = findIn(m, sel.id)
              if (d) setPortrait(d.entry, pickerSlot.scope, pickerSlot.size, name)
            })
            setPickerSlot(null)
          }}
          onClose={() => setPickerSlot(null)}
        />
      )}

      {condModal && condNodes && (
        <ConditionEditor
          blockKey={condModal.blockKey}
          nodes={condNodes.nodes}
          newline={modelRef.current?.file.newline ?? '\n'}
          onApply={(ns) => {
            mutate((m) => {
              const d = findIn(m, condModal.charId)
              if (d) setCharacterCondBlock(d.entry, condModal.blockKey, ns)
            })
            setCondModal(null)
          }}
          onClose={() => setCondModal(null)}
        />
      )}
    </div>
  )
}
