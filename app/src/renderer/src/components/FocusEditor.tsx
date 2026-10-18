import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  loadFocusTree,
  saveFocusTree,
  buildNodes,
  setFocusPos,
  setFocusCost,
  setFocusIcon,
  setRelativePositionId,
  setAvailableIfCapitulated,
  setCancelIfInvalid,
  getFocusCondBlock,
  setFocusCondBlock,
  renameFocus,
  addFocus,
  deleteFocus,
  togglePrerequisite,
  setStringList,
  suggestFocusId,
  getFocusFiredEvents,
  addFocusFiredEvent,
  removeFocusFiredEvent,
  getShortcuts,
  addShortcut,
  removeShortcut,
  setShortcutName,
  setShortcutTarget,
  setShortcutScrollFactor,
  getShortcutTrigger,
  setShortcutTrigger
} from '../../../shared/focusTree'
import type { FocusTreeModel, FocusNode } from '../../../shared/focusTree'
import type { CwItem } from '../../../shared/clausewitz'
import { suggestGlobalEventId } from '../../../shared/events'
import { loadLoc } from '../../../shared/localisation'
import { decodeDds, decodeTga } from '../../../shared/dds'
import type { IconSprite } from '../../../shared/types'
import IconPicker from './IconPicker'
import ConditionEditor from './ConditionEditor'

/** 画布网格单位（游戏内坐标 1 格 = 96 像素，节点图标 80 像素，与游戏内国策格比例接近） */
const GRID = 96
const NODE_HALF = 40

interface Props {
  path: string
  content: string
  gameDir: string | null
  modPath: string
  /** 模组内的本地化文件（国策反向联动：显示名称/描述状态并跳转） */
  locFiles: { path: string; rel: string }[]
  /** 跳转到本地化编辑器（autofill = 缺失键自动补全；keyOnly = 只补这一个键本身不加 _desc） */
  onOpenLoc: (focusId: string, locPath: string, autofill: boolean, keyOnly?: boolean) => void
  /** 模组内的事件文件（完成时触发事件联动） */
  eventFiles: { path: string; rel: string }[]
  /** 模组内全部事件 id；null 表示正在扫描 */
  eventIds: string[] | null
  /** 建议事件 id 用的命名空间（模组文件夹名大写） */
  eventNamespace: string
  /** 跳转到事件编辑器（eventPath null = 需要先创建事件文件；autofill = 事件缺失时自动创建） */
  onOpenEvent: (eventId: string, eventPath: string | null, autofill: boolean) => void
  /** 外部跳转：从事件编辑器点过来选中并居中某国策（token 变化才重新定位） */
  jumpId: string | null
  jumpToken: number
  onSaved: (text: string) => void
  onUnsavedChange: (dirty: boolean) => void
  /** 双栏中本栏是否激活；非激活栏不响应全局快捷键（默认 true，单栏用法不传） */
  active?: boolean
}

/** 小输入框：回车把值传给 onAdd */
function ChipInput({ onAdd, placeholder }: { onAdd: (v: string) => void; placeholder: string }): React.JSX.Element {
  const [v, setV] = useState('')
  return (
    <input
      className="text-input fe-chip-add"
      placeholder={placeholder}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && v.trim()) {
          onAdd(v.trim())
          setV('')
        }
      }}
    />
  )
}

export default function FocusEditor(props: Props): React.JSX.Element {
  const { path, content, gameDir, modPath, locFiles, onOpenLoc, eventFiles, eventIds, eventNamespace, onOpenEvent, jumpId, jumpToken, onSaved, onUnsavedChange, active } = props
  /** 渲染期赋值让 keydown 闭包始终读到最新激活状态（effect 依赖不变，避免反复挂卸监听） */
  const activeRef = useRef(active ?? true)
  activeRef.current = active ?? true
  const modelRef = useRef<FocusTreeModel | null>(null)
  /** 当前模型所基于的内容；保存回流的内容与之一致时跳过重建，保留撤销历史 */
  const loadedContentRef = useRef<string | null>(null)
  /** 外部跳转只应用一次（token 去重） */
  const jumpAppliedRef = useRef(0)
  /** 跳转居中第二段：节点渲染进 DOM 后把视口从「原点居中」修正到「节点整体中心」（标签宽度模型里未知） */
  const centerPendingRef = useRef<string | null>(null)
  const [tick, setTick] = useState(0)
  const [loadError, setLoadError] = useState('')
  const [selection, setSelection] = useState<string | null>(null)
  const [connectMode, setConnectMode] = useState(false)
  const [connectSource, setConnectSource] = useState<string | null>(null)
  const [view, setView] = useState({ x: 40, y: 40, scale: 1 })
  const [sprites, setSprites] = useState<IconSprite[]>([])
  const [showPicker, setShowPicker] = useState(false)
  const [condKey, setCondKey] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [statusMsg, setStatusMsg] = useState('')
  const [fireInput, setFireInput] = useState('')
  /** 快捷路径（翻页）编辑：null = 不编辑；等于 shortcuts.length 表示新增 */
  const [editScIdx, setEditScIdx] = useState<number | null>(null)
  const [scName, setScName] = useState('')
  const [scTarget, setScTarget] = useState('')
  const [scFactor, setScFactor] = useState('')
  /** 快捷路径 trigger 编辑弹窗的下标 */
  const [scCondIdx, setScCondIdx] = useState<number | null>(null)
  const historyRef = useRef<{ past: string[]; future: string[] }>({ past: [], future: [] })
  const viewRef = useRef(view)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const dragRef = useRef<{ entry: CwItem; px: number; py: number; sx: number; sy: number; pushed: boolean } | null>(null)
  const panRef = useRef<{ px: number; py: number; vx: number; vy: number } | null>(null)
  const urlCache = useRef(new Map<string, string | null>())
  /** 本地化索引：键 → 文本/占位/所在文件（国策反向联动用） */
  const locIndexRef = useRef<{ byKey: Map<string, { text: string; placeholder: boolean; path: string }>; paths: string[] } | null>(null)

  const applyView = useCallback((v: { x: number; y: number; scale: number }): void => {
    viewRef.current = v
    setView(v)
  }, [])

  const nodes = useMemo(() => (modelRef.current ? buildNodes(modelRef.current.root) : []), [tick])
  /** 快捷路径（翻页按钮）列表；下标定位，undo/redo 后随 tick 刷新 */
  const shortcuts = useMemo(() => (modelRef.current ? getShortcuts(modelRef.current.root) : []), [tick])
  const nodeIdSet = useMemo(() => new Set(nodes.map((n) => n.id)), [nodes])

  const findIn = (m: FocusTreeModel, id: string): FocusNode | null =>
    buildNodes(m.root).find((n) => n.id === id) ?? null

  const sel = selection ? (nodes.find((n) => n.id === selection) ?? null) : null

  // 选中节点的本地化状态（反向联动）
  const locName = sel ? (locIndexRef.current?.byKey.get(sel.id) ?? null) : null
  const locDesc = sel ? (locIndexRef.current?.byKey.get(`${sel.id}_desc`) ?? null) : null

  // 完成时触发事件（与事件编辑器联动）
  const fired = sel ? getFocusFiredEvents(sel.entry) : []
  const eventIdSet = useMemo(() => new Set(eventIds ?? []), [eventIds])

  // ---------- 加载与适应画布 ----------

  const fit = useCallback((): void => {
    const m = modelRef.current
    const el = svgRef.current
    if (!m || !el) return
    const ns = buildNodes(m.root)
    if (ns.length === 0) return
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const n of ns) {
      const sx = n.x * GRID
      const sy = n.y * GRID
      minX = Math.min(minX, sx - 56)
      maxX = Math.max(maxX, sx + 56)
      minY = Math.min(minY, sy - 64)
      maxY = Math.max(maxY, sy + 64)
    }
    const w = el.clientWidth || 800
    const h = el.clientHeight || 600
    const scale = Math.min(w / (maxX - minX), h / (maxY - minY), 1.25)
    applyView({ x: w / 2 - ((minX + maxX) / 2) * scale, y: h / 2 - ((minY + maxY) / 2) * scale, scale })
  }, [applyView])

  useEffect(() => {
    // 保存回流的内容：模型已与之一致，跳过重建（否则撤销历史会被清空，违反硬性要求#4）
    if (content !== loadedContentRef.current) {
      loadedContentRef.current = content
      const model = loadFocusTree(content)
      if (!model) {
        modelRef.current = null
        setLoadError('无法解析该文件为国策树（缺少顶层块）')
        setTick((t) => t + 1)
        return
      }
      modelRef.current = model
      historyRef.current = { past: [], future: [] }
      onUnsavedChange(false)
      setLoadError('')
      setSelection(null)
      setStatusMsg('')
      setTick((t) => t + 1)
    }
    // 外部跳转（从事件编辑器点回来）：直接在这里选中并居中目标国策，不排队 rAF。
    // effect 运行时 svg 已提交且尺寸可用，同步 applyView 即可，规避 rAF 时序/双挂载顺序问题。
    // StrictMode 双执行与保存回流由 jumpAppliedRef / loadedContentRef 去重。
    // 双栏下 token 可能单独变化（目标文件已打开 → 原地跳转不重读文件）：content 未变时复用现有模型，只走跳转分支。
    if (jumpToken !== 0 && jumpId && jumpAppliedRef.current !== jumpToken) {
      jumpAppliedRef.current = jumpToken
      const model = modelRef.current
      const n = model ? buildNodes(model.root).find((x) => x.id === jumpId) : null
      if (n) {
        setSelection(jumpId)
        const el = svgRef.current
        const w = el?.clientWidth || 800
        const h = el?.clientHeight || 600
        const scale = viewRef.current.scale || 1
        // 先按节点原点居中（此刻节点还没渲染进 DOM，测不到标签宽度），
        // 随后由 centerPendingRef + layout effect 在绘制前修正到节点整体中心
        applyView({ x: w / 2 - n.x * GRID * scale, y: h / 2 - n.y * GRID * scale, scale })
        centerPendingRef.current = jumpId
        return
      }
      // 目标国策不存在：退回常规适应画布
      const raf = requestAnimationFrame(fit)
      return () => cancelAnimationFrame(raf)
    }
    // 已消费过跳转（StrictMode 二次执行、保存回流等）：保持当前视图
    if (jumpToken !== 0) return
    const raf = requestAnimationFrame(fit)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, content, jumpToken])

  // 跳转居中第二段：节点渲染进 DOM 后，同步测量实际 bbox 并把视口修正到节点整体中心。
  // layout effect 在绘制前执行，不闪屏；节点尚未渲染时（StrictMode 双执行会提前跑一次）
  // 不消费标记，留给下一次提交重试——只有真正测量过才清标记，否则修正会永久丢失。
  useLayoutEffect(() => {
    if (!centerPendingRef.current) return
    const id = centerPendingRef.current
    const svg = svgRef.current
    const nodeEl = svg?.querySelector<SVGGElement>(`.focus-node[data-id="${CSS.escape(id)}"]`)
    if (!svg || !nodeEl) return
    centerPendingRef.current = null
    const sr = svg.getBoundingClientRect()
    const nr = nodeEl.getBoundingClientRect()
    const v = viewRef.current
    const s = v.scale || 1
    applyView({
      ...v,
      x: v.x + (sr.left + sr.width / 2 - (nr.left + nr.width / 2)) / s,
      y: v.y + (sr.top + sr.height / 2 - (nr.top + nr.height / 2)) / s
    })
  })

  useEffect(() => {
    void (async () => {
      try {
        setSprites(await window.api.listGoalSprites(gameDir, [modPath]))
      } catch {
        setSprites([])
      }
    })()
  }, [gameDir, modPath])

  // ---------- 本地化索引（国策反向联动） ----------

  useEffect(() => {
    let cancelled = false
    locIndexRef.current = null
    void (async () => {
      const byKey = new Map<string, { text: string; placeholder: boolean; path: string }>()
      for (const f of locFiles) {
        try {
          const loc = loadLoc(await window.api.readTextFile(f.path))
          if (!loc) continue
          for (const e of loc.entries) {
            if (!byKey.has(e.key)) byKey.set(e.key, { text: e.text, placeholder: e.placeholder, path: f.path })
          }
        } catch {
          // 单个文件读取失败就跳过
        }
      }
      if (cancelled) return
      locIndexRef.current = { byKey, paths: locFiles.map((f) => f.path) }
      setTick((t) => t + 1)
    })()
    return () => {
      cancelled = true
    }
  }, [locFiles])

  /** 选中国策对应的本地化文件：有键用它所在文件；全缺则用含本树 id 最多的文件 */
  const pickLocPath = (id: string): string | null => {
    const idx = locIndexRef.current
    if (!idx || idx.paths.length === 0) return null
    const name = idx.byKey.get(id)
    if (name) return name.path
    const desc = idx.byKey.get(`${id}_desc`)
    if (desc) return desc.path
    const nodeIds = new Set(nodes.map((n) => n.id))
    const scoreOf = new Map<string, number>()
    for (const [k, v] of idx.byKey) {
      const base = k.endsWith('_desc') ? k.slice(0, -5) : k
      if (nodeIds.has(base)) scoreOf.set(v.path, (scoreOf.get(v.path) ?? 0) + 1)
    }
    let best = idx.paths[0]
    let bestScore = -1
    for (const p of idx.paths) {
      const s = scoreOf.get(p) ?? 0
      if (s > bestScore) {
        bestScore = s
        best = p
      }
    }
    return best
  }

  // ---------- 修改 / 撤销 / 重做 ----------

  const mutate = useCallback(
    (fn: (m: FocusTreeModel) => void): void => {
      const m = modelRef.current
      if (!m) return
      historyRef.current = {
        past: [...historyRef.current.past.slice(-99), saveFocusTree(m)],
        future: []
      }
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
    const restored = loadFocusTree(prev)
    if (!restored) return
    h.past.pop()
    h.future.unshift(saveFocusTree(m))
    modelRef.current = restored
    onUnsavedChange(h.past.length > 0)
    setTick((t) => t + 1)
    // 快捷路径列表可能变化，关闭编辑表单防下标漂移
    setEditScIdx(null)
    setScCondIdx(null)
  }, [onUnsavedChange])

  const redo = useCallback((): void => {
    const m = modelRef.current
    const h = historyRef.current
    if (!m) return
    const next = h.future[0]
    if (next === undefined) return
    const restored = loadFocusTree(next)
    if (!restored) return
    h.future.shift()
    h.past.push(saveFocusTree(m))
    modelRef.current = restored
    onUnsavedChange(true)
    setTick((t) => t + 1)
    // 快捷路径列表可能变化，关闭编辑表单防下标漂移
    setEditScIdx(null)
    setScCondIdx(null)
  }, [onUnsavedChange])

  /** 保存快捷路径表单：下标等于列表长度 = 新增，否则修改现有条目（一步撤销） */
  const saveShortcut = (): void => {
    const name = scName.trim()
    const target = scTarget.trim()
    if (!name || !target) return
    mutate((m) => {
      const scs = getShortcuts(m.root)
      if (editScIdx === scs.length) {
        const entry = addShortcut(m, name, target)
        const fv = Number(scFactor)
        if (Number.isFinite(fv)) setShortcutScrollFactor(entry, fv)
      } else {
        const sc = scs[editScIdx ?? -1]
        if (sc) {
          setShortcutName(sc.entry, name)
          setShortcutTarget(sc.entry, target)
          const fv = Number(scFactor)
          setShortcutScrollFactor(sc.entry, scFactor.trim() === '' || !Number.isFinite(fv) ? null : fv)
        }
      }
    })
    setEditScIdx(null)
  }

  /** 删除当前编辑的快捷路径 */
  const deleteShortcut = (): void => {
    const i = editScIdx
    mutate((m) => {
      const scs = getShortcuts(m.root)
      const sc = scs[i ?? -1]
      if (sc) removeShortcut(m.root, sc.index)
    })
    setEditScIdx(null)
  }

  const save = useCallback(async (): Promise<void> => {
    const m = modelRef.current
    if (!m || saving) return
    setSaving(true)
    try {
      const text = saveFocusTree(m)
      await window.api.writeTextFile(path, text)
      // 登记回流内容：onSaved 会把同一文本 setContent 回来，跳过重建（保住选中与撤销历史，硬性要求#4）
      loadedContentRef.current = text
      onUnsavedChange(false)
      setStatusMsg('已保存（修改前的文件已自动备份）')
      onSaved(text)
    } catch (err) {
      setStatusMsg(`保存失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSaving(false)
    }
  }, [path, saving, onSaved, onUnsavedChange])

  const revert = useCallback((): void => {
    if (historyRef.current.past.length > 0 && !window.confirm('确定放弃所有未保存的修改？')) return
    const model = loadFocusTree(content)
    if (model) {
      modelRef.current = model
      historyRef.current = { past: [], future: [] }
      onUnsavedChange(false)
      setStatusMsg('已还原为磁盘上的内容')
      setTick((t) => t + 1)
    }
  }, [content, onUnsavedChange])

  /** 手动关联已有事件：在完成效果里加 country_event = { id = xxx } */
  const linkFiredEvent = useCallback((): void => {
    const id = fireInput.trim()
    if (!sel || !/^[A-Za-z0-9_]+\.\d+$/.test(id)) {
      setStatusMsg('事件 id 格式应为「命名空间.编号」，如 FRA.1')
      return
    }
    mutate((m) => {
      const n = findIn(m, sel.id)
      if (n) addFocusFiredEvent(n.entry, id)
    })
    setFireInput('')
    setStatusMsg(`已关联事件 ${id}（记得保存后到事件编辑器里创建它）`)
  }, [fireInput, sel, mutate])

  /** 一键添加触发事件：加效果 → 自动保存 → 跳到事件编辑器（无事件文件则先创建，缺失事件自动补全） */
  const oneClickFire = useCallback(async (): Promise<void> => {
    if (!sel || eventIds === null) return
    const id = suggestGlobalEventId(eventIds, eventNamespace)
    mutate((m) => {
      const n = findIn(m, sel.id)
      if (n) addFocusFiredEvent(n.entry, id)
    })
    // 先保存：事件编辑器按磁盘内容扫描国策引用
    const m = modelRef.current
    if (m) {
      setSaving(true)
      try {
        const text = saveFocusTree(m)
        await window.api.writeTextFile(path, text)
        // 登记回流内容：跳转后重新挂载时加载 effect 直接复用，不重建模型
        loadedContentRef.current = text
        onUnsavedChange(false)
        setStatusMsg('已保存（修改前的文件已自动备份）')
        onSaved(text)
      } catch (err) {
        setStatusMsg(`保存失败：${err instanceof Error ? err.message : String(err)}`)
        setSaving(false)
        return
      }
      setSaving(false)
    }
    onOpenEvent(id, eventFiles[0]?.path ?? null, true)
  }, [sel, eventIds, eventNamespace, eventFiles, path, mutate, onUnsavedChange, onSaved, onOpenEvent])

  // 快捷键：Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y / Ctrl+S / Esc
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!activeRef.current) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.ctrlKey || e.metaKey) {
        const k = e.key.toLowerCase()
        if (k === 'z') {
          e.preventDefault()
          if (e.shiftKey) redo()
          else undo()
        } else if (k === 'y') {
          e.preventDefault()
          redo()
        } else if (k === 's') {
          e.preventDefault()
          void save()
        }
      } else if (e.key === 'Escape') {
        setConnectMode(false)
        setConnectSource(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo, save])

  // ---------- 拖拽 / 平移 / 缩放 ----------

  const onDragMove = useCallback(
    (e: PointerEvent): void => {
      const d = dragRef.current
      const m = modelRef.current
      if (!d || !m) return
      const v = viewRef.current
      const gx = d.sx + (e.clientX - d.px) / (GRID * v.scale)
      const gy = d.sy + (e.clientY - d.py) / (GRID * v.scale)
      // 拖拽期间直接改 entry（pointerdown 时已拿到引用，省去每次 move 全量 buildNodes 查找）
      if (!d.pushed) {
        // 整个拖拽手势只入档一次，作为一步撤销
        historyRef.current = { past: [...historyRef.current.past.slice(-99), saveFocusTree(m)], future: [] }
        onUnsavedChange(true)
        d.pushed = true
      }
      setFocusPos(d.entry, gx, gy)
      setTick((t) => t + 1)
    },
    [onUnsavedChange]
  )

  const onDragEnd = useCallback((): void => {
    dragRef.current = null
    window.removeEventListener('pointermove', onDragMove)
    window.removeEventListener('pointerup', onDragEnd)
  }, [onDragMove])

  const onPanMove = useCallback(
    (e: PointerEvent): void => {
      const p = panRef.current
      if (!p) return
      applyView({ ...viewRef.current, x: p.vx + (e.clientX - p.px), y: p.vy + (e.clientY - p.py) })
    },
    [applyView]
  )

  const onPanEnd = useCallback((): void => {
    panRef.current = null
    window.removeEventListener('pointermove', onPanMove)
    window.removeEventListener('pointerup', onPanEnd)
  }, [onPanMove])

  const onNodeDown = (e: React.PointerEvent, id: string): void => {
    if (e.button !== 0) return
    e.stopPropagation()
    setSelection(id)
    if (connectMode) {
      if (!connectSource) {
        setConnectSource(id)
      } else if (connectSource !== id) {
        mutate((m) => {
          const t = findIn(m, id)
          if (t) togglePrerequisite(t.entry, connectSource)
        })
        setConnectSource(null)
        setStatusMsg('已添加连线')
      } else {
        setConnectSource(null)
      }
      return
    }
    const n = nodes.find((x) => x.id === id)
    if (!n) return
    dragRef.current = { entry: n.entry, px: e.clientX, py: e.clientY, sx: n.x, sy: n.y, pushed: false }
    window.addEventListener('pointermove', onDragMove)
    window.addEventListener('pointerup', onDragEnd)
  }

  const onCanvasDown = (e: React.PointerEvent): void => {
    if (e.button !== 0) return
    if (connectMode) {
      setConnectSource(null)
      return
    }
    panRef.current = { px: e.clientX, py: e.clientY, vx: viewRef.current.x, vy: viewRef.current.y }
    window.addEventListener('pointermove', onPanMove)
    window.addEventListener('pointerup', onPanEnd)
  }

  const onWheel = (e: React.WheelEvent): void => {
    const el = svgRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    const v = viewRef.current
    const ns = Math.min(3, Math.max(0.15, v.scale * Math.exp(-e.deltaY * 0.0012)))
    applyView({ scale: ns, x: px - ((px - v.x) * ns) / v.scale, y: py - ((py - v.y) * ns) / v.scale })
  }

  const zoomIn = (): void => {
    const el = svgRef.current
    const cx = el ? el.clientWidth / 2 : 400
    const cy = el ? el.clientHeight / 2 : 300
    const v = viewRef.current
    const ns = Math.min(3, v.scale * 1.25)
    applyView({ scale: ns, x: cx - ((cx - v.x) * ns) / v.scale, y: cy - ((cy - v.y) * ns) / v.scale })
  }

  const zoomOut = (): void => {
    const el = svgRef.current
    const cx = el ? el.clientWidth / 2 : 400
    const cy = el ? el.clientHeight / 2 : 300
    const v = viewRef.current
    const ns = Math.max(0.15, v.scale / 1.25)
    applyView({ scale: ns, x: cx - ((cx - v.x) * ns) / v.scale, y: cy - ((cy - v.y) * ns) / v.scale })
  }

  // ---------- 节点操作 ----------

  const addNewFocus = (): void => {
    let newId = ''
    mutate((m) => {
      const el = svgRef.current
      const v = viewRef.current
      const cx = el ? el.clientWidth / 2 : 400
      const cy = el ? el.clientHeight / 2 : 300
      const gx = Math.round((cx - v.x) / v.scale / GRID)
      const gy = Math.round((cy - v.y) / v.scale / GRID)
      newId = suggestFocusId(m, 'new_focus')
      addFocus(m, newId, gx, gy)
    })
    setSelection(newId)
    setStatusMsg(`已添加国策「${newId}」，请在右侧修改它的属性`)
  }

  const removeSelected = (): void => {
    if (!selection) return
    if (!window.confirm(`确定删除国策「${selection}」吗？其它国策对它的引用会一并清理，可以撤销。`)) return
    mutate((m) => deleteFocus(m, selection))
    setSelection(null)
  }

  const rename = (oldId: string, newIdRaw: string): void => {
    const newId = newIdRaw.trim()
    if (!newId || newId === oldId) return
    if (nodes.some((n) => n.id === newId)) {
      setStatusMsg(`id「${newId}」已存在，不能重名`)
      return
    }
    mutate((m) => {
      const ns = buildNodes(m.root)
      for (const n of ns) {
        if (n.id === oldId) continue
        if (n.prerequisites.includes(oldId)) {
          setStringList(n.entry, 'prerequisite', n.prerequisites.map((p) => (p === oldId ? newId : p)))
        }
        if (n.mutuallyExclusive.includes(oldId)) {
          setStringList(n.entry, 'mutually_exclusive', n.mutuallyExclusive.map((p) => (p === oldId ? newId : p)))
        }
        if (n.relativePositionId === oldId) setRelativePositionId(n.entry, newId)
      }
      const node = ns.find((n) => n.id === oldId)
      if (node) renameFocus(node.entry, newId)
    })
    setSelection(newId)
  }

  // ---------- 图标 ----------

  const spriteFor = (name: string): IconSprite | undefined => {
    if (!name) return undefined
    return sprites.find((s) => s.name === name) ?? sprites.find((s) => s.name === `GFX_${name}`)
  }

  const getIconUrl = useCallback((sprite: IconSprite): string | null => {
    const c = urlCache.current
    const hit = c.get(sprite.name)
    if (hit !== undefined) return hit
    c.set(sprite.name, null) // 占位，避免并发重复解码
    const texPath = sprite.path
    if (!texPath) return null
    void (async () => {
      let url: string | null = null
      try {
        const bytes = new Uint8Array(await window.api.readBytes(texPath))
        const ext = texPath.split('.').pop()?.toLowerCase()
        const img = ext === 'tga' ? decodeTga(bytes) : decodeDds(bytes)
        if (img) {
          const canvas = document.createElement('canvas')
          canvas.width = img.width
          canvas.height = img.height
          const ctx = canvas.getContext('2d')
          if (ctx) {
            ctx.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0)
            url = canvas.toDataURL()
          }
        }
      } catch {
        url = null
      }
      c.set(sprite.name, url)
      setTick((t) => t + 1)
    })()
    return null
  }, [])

  // ---------- 渲染 ----------

  const edges = useMemo(() => {
    const map = new Map(nodes.map((n) => [n.id, n]))
    const list: { key: string; sx: number; sy: number; tx: number; ty: number; hl: boolean }[] = []
    for (const n of nodes) {
      for (const p of n.prerequisites) {
        const src = map.get(p)
        if (!src) continue
        list.push({
          key: `${p}->${n.id}`,
          sx: src.x * GRID,
          sy: src.y * GRID,
          tx: n.x * GRID,
          ty: n.y * GRID,
          hl: selection === n.id || selection === p
        })
      }
    }
    return list
  }, [nodes, selection])

  if (loadError && !modelRef.current) {
    return (
      <div className="viewer-empty">
        <p>{loadError}</p>
        <p className="viewer-empty-note">请切换到「文本」模式查看原始内容。</p>
      </div>
    )
  }

  return (
    <div className="focus-editor">
      <div className="fe-toolbar">
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
        <button className="btn small" onClick={addNewFocus}>
          ＋ 添加国策
        </button>
        <button
          className={connectMode ? 'btn small primary' : 'btn small'}
          onClick={() => {
            setConnectMode(!connectMode)
            setConnectSource(null)
          }}
        >
          🔗 连线
        </button>
        <span className="fe-hint">
          {connectMode
            ? connectSource
              ? `已选起点「${connectSource}」，再点击它的目标国策`
              : '连线模式：先点前置国策，再点它的目标国策（Esc 退出）'
            : statusMsg}
        </span>
        <span className="fe-spacer" />
        <span className="fe-zoom-label">{nodes.length} 个国策</span>
        <button className="btn small" onClick={fit}>
          适应画布
        </button>
        <button className="btn small" onClick={zoomOut}>
          −
        </button>
        <span className="fe-zoom">{Math.round(view.scale * 100)}%</span>
        <button className="btn small" onClick={zoomIn}>
          ＋
        </button>
      </div>

      <div className="fe-main">
        <svg
          ref={svgRef}
          className="fe-canvas"
          onPointerDown={onCanvasDown}
          onWheel={onWheel}
        >
          <defs>
            <marker id="arrow-dim" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
              <path d="M0,0 L8,4 L0,8 z" fill="#55555e" />
            </marker>
            <marker id="arrow-hl" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
              <path d="M0,0 L8,4 L0,8 z" fill="#5b8db8" />
            </marker>
          </defs>
          <g transform={`translate(${view.x}, ${view.y}) scale(${view.scale})`}>
            {edges.map((e) => {
              const dx = e.tx - e.sx
              const dy = e.ty - e.sy
              const len = Math.hypot(dx, dy) || 1
              const ux = dx / len
              const uy = dy / len
              return (
                <line
                  key={e.key}
                  x1={e.sx + ux * (NODE_HALF + 4)}
                  y1={e.sy + uy * (NODE_HALF + 4)}
                  x2={e.tx - ux * (NODE_HALF + 8)}
                  y2={e.ty - uy * (NODE_HALF + 8)}
                  className={e.hl ? 'focus-edge hl' : 'focus-edge'}
                  markerEnd={e.hl ? 'url(#arrow-hl)' : 'url(#arrow-dim)'}
                />
              )
            })}
            {nodes.map((n) => {
              const sprite = spriteFor(n.icon)
              const url = sprite ? getIconUrl(sprite) : null
              const cls = [
                'focus-node',
                selection === n.id ? 'selected' : '',
                connectSource === n.id ? 'conn-source' : ''
              ]
                .filter(Boolean)
                .join(' ')
              return (
                <g
                  key={n.id}
                  data-id={n.id}
                  className={cls}
                  transform={`translate(${n.x * GRID}, ${n.y * GRID})`}
                  onPointerDown={(e) => onNodeDown(e, n.id)}
                  style={{ cursor: connectMode ? 'crosshair' : 'move' }}
                >
                  <rect x={-NODE_HALF} y={-NODE_HALF} width={NODE_HALF * 2} height={NODE_HALF * 2} rx={4} />
                  {url ? (
                    <image
                      href={url}
                      x={-NODE_HALF + 4}
                      y={-NODE_HALF + 4}
                      width={NODE_HALF * 2 - 8}
                      height={NODE_HALF * 2 - 8}
                      preserveAspectRatio="xMidYMid meet"
                    />
                  ) : (
                    <text className="focus-noicon" x={0} y={2} textAnchor="middle" dominantBaseline="middle">
                      ?
                    </text>
                  )}
                  <rect className="cost-badge" x={NODE_HALF - 14} y={-NODE_HALF + 2} width={12} height={12} rx={2} />
                  <text className="cost-text" x={NODE_HALF - 8} y={-NODE_HALF + 11} textAnchor="middle">
                    {n.cost}
                  </text>
                  <text className="focus-label" x={0} y={NODE_HALF + 14} textAnchor="middle">
                    {n.id}
                  </text>
                </g>
              )
            })}
          </g>
        </svg>

        <div className="fe-props">
          <div className="fe-section-title">快捷路径（翻页）</div>
          <div className="fe-loc-box">
            <div className="fe-title-note">游戏内显示为翻页快捷按钮，点击跳转到目标国策（1.15+）</div>
            {shortcuts.length === 0 && editScIdx === null && <div className="fe-loc-text dim">还没有快捷路径</div>}
            {shortcuts.map((sc, i) => (
              <div className="fe-sc-row" key={sc.index}>
                <code title={`name = ${sc.name ?? ''}`}>{sc.name ?? '（无名称）'}</code>
                <span className="fe-loc-text">→ {sc.target ?? '（无目标）'}</span>
                {sc.target && !nodeIdSet.has(sc.target) && (
                  <span className="fe-loc-badge missing" title="target 指向的国策在画布上不存在">
                    ❌ 目标国策不存在
                  </span>
                )}
                {sc.hasTrigger && <span className="fe-loc-badge ok">带显示条件</span>}
                <span className="fe-spacer" />
                <button className="btn tiny" title="编辑显示条件（trigger）" onClick={() => setScCondIdx(i)}>
                  触发条件
                </button>
                <button
                  className="btn tiny"
                  onClick={() => {
                    setEditScIdx(i)
                    setScName(sc.name ?? '')
                    setScTarget(sc.target ?? '')
                    setScFactor(sc.scrollWheelFactorText ?? '')
                  }}
                >
                  编辑
                </button>
                <button
                  className="btn tiny"
                  title="删除该快捷路径"
                  onClick={() => {
                    mutate((m) => {
                      const scs = getShortcuts(m.root)
                      const cur = scs[i]
                      if (cur) removeShortcut(m.root, cur.index)
                    })
                    setEditScIdx(null)
                  }}
                >
                  ×
                </button>
              </div>
            ))}
            {editScIdx !== null && editScIdx <= shortcuts.length && (
              <div className="fe-sc-form">
                <label className="fe-field">
                  <span>name（本地化键）</span>
                  <input className="text-input" placeholder="如 fra_sc_next" value={scName} onChange={(e) => setScName(e.target.value)} />
                </label>
                {scName.trim() !== '' && (
                  <div className="fe-loc-status">
                    名称本地化
                    {locIndexRef.current === null ? (
                      <span className="fe-loc-badge warn">正在读取本地化文件…</span>
                    ) : (() => {
                      const hit = locIndexRef.current.byKey.get(scName.trim())
                      return hit ? (
                        <span className={hit.placeholder ? 'fe-loc-badge warn' : 'fe-loc-badge ok'}>
                          {hit.placeholder ? '⚠ 占位未翻译' : '✅ 已翻译'}
                        </span>
                      ) : (
                        <span className="fe-loc-badge missing">❌ 缺失</span>
                      )
                    })()}
                  </div>
                )}
                <div className="fe-loc-actions">
                  <button
                    className="btn small"
                    disabled={locIndexRef.current === null || locFiles.length === 0 || scName.trim() === ''}
                    onClick={() => {
                      const key = scName.trim()
                      const p = pickLocPath(key)
                      if (p) onOpenLoc(key, p, !locIndexRef.current?.byKey.has(key), true)
                    }}
                  >
                    编辑本地化
                  </button>
                </div>
                <label className="fe-field">
                  <span>target（目标国策）</span>
                  <select className="text-input" value={scTarget} onChange={(e) => setScTarget(e.target.value)}>
                    <option value="">（选择国策）</option>
                    {nodes.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.id}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="fe-field">
                  <span>scroll_wheel_factor（滚轮缩放，留空不写）</span>
                  <input className="text-input" type="number" value={scFactor} onChange={(e) => setScFactor(e.target.value)} />
                </label>
                <div className="fe-loc-actions">
                  <button className="btn small primary" disabled={scName.trim() === '' || scTarget === ''} onClick={saveShortcut}>
                    保存
                  </button>
                  {editScIdx !== shortcuts.length && (
                    <button className="btn small" onClick={deleteShortcut}>
                      删除
                    </button>
                  )}
                  <button className="btn small" onClick={() => setEditScIdx(null)}>
                    取消
                  </button>
                </div>
              </div>
            )}
            {editScIdx === null && (
              <button
                className="btn small"
                onClick={() => {
                  setEditScIdx(shortcuts.length)
                  setScName('')
                  setScTarget('')
                  setScFactor('')
                }}
              >
                ＋ 添加快捷路径
              </button>
            )}
          </div>

          {!sel ? (
            <div className="fe-props-empty">
              <p>在画布上选择一个国策</p>
              <ul>
                <li>拖动国策调整位置</li>
                <li>「连线」模式下点两个国策建立前置关系</li>
                <li>滚轮缩放 · 拖空白处平移</li>
                <li>Ctrl+Z 撤销 · Ctrl+S 保存</li>
              </ul>
            </div>
          ) : (
            <>
              <h3>国策属性</h3>
              <label className="fe-field">
                <span>id（名称键）</span>
                <input
                  className="text-input"
                  value={sel.id}
                  onChange={(e) => rename(sel.id, e.target.value)}
                  onBlur={(e) => {
                    if (e.target.value.trim() !== sel.id) rename(sel.id, e.target.value)
                  }}
                />
              </label>
              <div className="fe-row">
                <label className="fe-field">
                  <span>X 坐标</span>
                  <input
                    className="text-input"
                    type="number"
                    value={sel.x}
                    onChange={(e) => {
                      const v = Number(e.target.value)
                      if (Number.isFinite(v)) mutate((m) => { const n = findIn(m, sel.id); if (n) setFocusPos(n.entry, v, n.y) })
                    }}
                  />
                </label>
                <label className="fe-field">
                  <span>Y 坐标</span>
                  <input
                    className="text-input"
                    type="number"
                    value={sel.y}
                    onChange={(e) => {
                      const v = Number(e.target.value)
                      if (Number.isFinite(v)) mutate((m) => { const n = findIn(m, sel.id); if (n) setFocusPos(n.entry, n.x, v) })
                    }}
                  />
                </label>
              </div>
              <label className="fe-field">
                <span>花费天数（cost）</span>
                <input
                  className="text-input"
                  type="number"
                  value={sel.cost}
                  onChange={(e) => {
                    const v = Number(e.target.value)
                    if (Number.isFinite(v)) mutate((m) => { const n = findIn(m, sel.id); if (n) setFocusCost(n.entry, v) })
                  }}
                />
              </label>
              <label className="fe-field">
                <span>图标（icon）</span>
                <div className="fe-icon-row">
                  <div className="fe-icon-preview">
                    {(() => {
                      const sp = spriteFor(sel.icon)
                      const u = sp ? getIconUrl(sp) : null
                      return u ? <img src={u} alt="" draggable={false} /> : <span>?</span>
                    })()}
                  </div>
                  <input
                    className="text-input"
                    value={sel.icon}
                    placeholder="如 GFX_goal_generic_xxx"
                    onChange={(e) => mutate((m) => { const n = findIn(m, sel.id); if (n) setFocusIcon(n.entry, e.target.value) })}
                  />
                  <button className="btn small" onClick={() => setShowPicker(true)}>
                    选择…
                  </button>
                </div>
              </label>

              <div className="fe-section-title">
                前置条件（prerequisite）
                <span className="fe-title-note">用「连线」模式在画布上点两个国策即可添加</span>
              </div>
              <div className="fe-chips">
                {sel.prerequisites.length === 0 && <span className="fe-chip-none">无（不需要前置国策）</span>}
                {sel.prerequisites.map((p) => (
                  <span key={p} className={nodes.some((n) => n.id === p) ? 'fe-chip' : 'fe-chip missing'} title={nodes.some((n) => n.id === p) ? p : '该 id 在本文件中不存在'}>
                    {p}
                    <button
                      onClick={() =>
                        mutate((m) => { const n = findIn(m, sel.id); if (n) setStringList(n.entry, 'prerequisite', n.prerequisites.filter((x) => x !== p)) })
                      }
                    >
                      ×
                    </button>
                  </span>
                ))}
                <ChipInput
                  placeholder="输入 id 回车添加"
                  onAdd={(v) =>
                    mutate((m) => { const n = findIn(m, sel.id); if (n) setStringList(n.entry, 'prerequisite', [...n.prerequisites, v]) })
                  }
                />
              </div>

              <div className="fe-section-title">互斥（mutually_exclusive）</div>
              <div className="fe-chips">
                {sel.mutuallyExclusive.length === 0 && <span className="fe-chip-none">无</span>}
                {sel.mutuallyExclusive.map((p) => (
                  <span key={p} className="fe-chip">
                    {p}
                    <button
                      onClick={() =>
                        mutate((m) => { const n = findIn(m, sel.id); if (n) setStringList(n.entry, 'mutually_exclusive', n.mutuallyExclusive.filter((x) => x !== p)) })
                      }
                    >
                      ×
                    </button>
                  </span>
                ))}
                <ChipInput
                  placeholder="输入 id 回车添加"
                  onAdd={(v) =>
                    mutate((m) => { const n = findIn(m, sel.id); if (n) setStringList(n.entry, 'mutually_exclusive', [...n.mutuallyExclusive, v]) })
                  }
                />
              </div>

              <label className="fe-field">
                <span>相对位置（relative_position_id）</span>
                <div className="fe-icon-row">
                  <input
                    className="text-input"
                    value={sel.relativePositionId ?? ''}
                    placeholder="留空 = 不跟随任何国策"
                    onChange={(e) => mutate((m) => { const n = findIn(m, sel.id); if (n) setRelativePositionId(n.entry, e.target.value.trim() === '' ? null : e.target.value.trim()) })}
                  />
                </div>
              </label>

              <label className="fe-check">
                <input
                  type="checkbox"
                  checked={sel.availableIfCapitulated}
                  onChange={(e) => mutate((m) => { const n = findIn(m, sel.id); if (n) setAvailableIfCapitulated(n.entry, e.target.checked) })}
                />
                投降后仍可进行（available_if_capitulated）
              </label>

              <div className="fe-section-title">搜索分类（search_filters）</div>
              <div className="fe-chips">
                {sel.searchFilters.length === 0 && <span className="fe-chip-none">无</span>}
                {sel.searchFilters.map((p) => (
                  <span key={p} className="fe-chip">
                    {p}
                    <button
                      onClick={() =>
                        mutate((m) => { const n = findIn(m, sel.id); if (n) setStringList(n.entry, 'search_filters', n.searchFilters.filter((x) => x !== p)) })
                      }
                    >
                      ×
                    </button>
                  </span>
                ))}
                <ChipInput
                  placeholder="如 FOCUS_FILTER_POLITICAL"
                  onAdd={(v) =>
                    mutate((m) => { const n = findIn(m, sel.id); if (n) setStringList(n.entry, 'search_filters', [...n.searchFilters, v]) })
                  }
                />
              </div>

              <div className="fe-section-title">条件与效果（点击进入结构化编辑）</div>
              <div className="fe-badges">
                {[
                  { key: 'available', zh: '可用条件', has: sel.hasAvailable },
                  { key: 'completion_reward', zh: '完成效果', has: sel.hasCompletionReward },
                  { key: 'bypass', zh: '跳过条件', has: sel.hasBypass }
                ].map((b) => {
                  const count = getFocusCondBlock(sel.entry, b.key)?.length ?? 0
                  return (
                    <button
                      key={b.key}
                      className={b.has ? 'fe-badge on clickable' : 'fe-badge off clickable'}
                      onClick={() => setCondKey(b.key)}
                    >
                      {b.has ? '✓' : '＋'} {b.zh} <code>{b.key}</code>
                      {b.has && count > 0 ? `（${count} 条）` : ''}
                    </button>
                  )
                })}
              </div>
              <div className="fe-section-title">完成时触发事件（与事件编辑器联动）</div>
              <div className="fe-loc-box">
                {fired.length === 0 && <div className="fe-loc-text dim">该国策完成时不触发任何事件</div>}
                {fired.map((f) => (
                  <div className="fe-fire-row" key={`${f.effectKey}:${f.id}`}>
                    <code title={`效果：${f.effectKey}`}>{f.id}</code>
                    {eventIds === null ? (
                      <span className="fe-loc-badge warn">正在扫描事件文件…</span>
                    ) : eventIdSet.has(f.id) ? (
                      <span className="fe-loc-badge ok">✅ 事件已存在</span>
                    ) : (
                      <span className="fe-loc-badge missing">❌ 事件文件里没有</span>
                    )}
                    <span className="fe-spacer" />
                    <button
                      className="btn tiny"
                      disabled={eventIds === null}
                      onClick={() => onOpenEvent(f.id, eventFiles[0]?.path ?? null, !eventIdSet.has(f.id))}
                    >
                      编辑事件
                    </button>
                    <button
                      className="btn tiny"
                      title="移除这个触发效果"
                      onClick={() =>
                        mutate((m) => {
                          const n = findIn(m, sel.id)
                          if (n) removeFocusFiredEvent(n.entry, f.id)
                        })
                      }
                    >
                      ×
                    </button>
                  </div>
                ))}
                <div className="fe-loc-actions">
                  <input
                    className="text-input fe-fire-input"
                    placeholder="输入事件 id（如 FRA.1）"
                    value={fireInput}
                    onChange={(e) => setFireInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') linkFiredEvent()
                    }}
                  />
                  <button className="btn small" onClick={linkFiredEvent}>
                    ＋ 关联已有事件
                  </button>
                  <button className="btn small primary" disabled={eventIds === null} onClick={() => void oneClickFire()}>
                    ＋ 一键添加触发事件
                  </button>
                </div>
                {eventFiles.length === 0 && (
                  <div className="fe-title-note">模组里还没有事件文件，一键添加会自动创建并保存本文件后跳转</div>
                )}
              </div>
              <div className="fe-section-title">本地化（名称与描述）</div>
              <div className="fe-loc-box">
                {locIndexRef.current === null ? (
                  <div className="fe-loc-text dim">正在读取本地化文件…</div>
                ) : locFiles.length === 0 ? (
                  <div className="fe-loc-text dim">模组里没有 localisation 文件</div>
                ) : (
                  <>
                    <div className="fe-loc-status">
                      名称
                      {locName ? (
                        <span className={locName.placeholder ? 'fe-loc-badge warn' : 'fe-loc-badge ok'}>
                          {locName.placeholder ? '⚠ 占位未翻译' : '✅ 已翻译'}
                        </span>
                      ) : (
                        <span className="fe-loc-badge missing">❌ 缺失</span>
                      )}
                    </div>
                    <div className="fe-loc-text">{locName ? locName.text : '（本地化文件中没有该键）'}</div>
                    <div className="fe-loc-status">
                      描述
                      {locDesc ? (
                        <span className={locDesc.placeholder ? 'fe-loc-badge warn' : 'fe-loc-badge ok'}>
                          {locDesc.placeholder ? '⚠ 占位未翻译' : '✅ 已翻译'}
                        </span>
                      ) : (
                        <span className="fe-loc-badge missing">❌ 缺失</span>
                      )}
                    </div>
                    <div className="fe-loc-text">{locDesc ? locDesc.text : '（本地化文件中没有该键）'}</div>
                    <div className="fe-loc-actions">
                      <button
                        className="btn small primary"
                        disabled={locIndexRef.current === null || locFiles.length === 0}
                        onClick={() => {
                          const p = pickLocPath(sel.id)
                          if (p) onOpenLoc(sel.id, p, !(locName && locDesc))
                        }}
                      >
                        {locName && locDesc ? '编辑本地化' : '补全并编辑'}
                      </button>
                      {!(locName && locDesc) && <span className="fe-title-note">缺失的键会自动补全</span>}
                    </div>
                  </>
                )}
              </div>

              <label className="fe-check">
                <input
                  type="checkbox"
                  checked={sel.cancelIfInvalid}
                  onChange={(e) => mutate((m) => { const n = findIn(m, sel.id); if (n) setCancelIfInvalid(n.entry, e.target.checked) })}
                />
                取消时失效（cancel_if_invalid）
              </label>

              <button className="btn fe-delete" onClick={removeSelected}>
                删除这个国策
              </button>
            </>
          )}
        </div>
      </div>

      {showPicker && (
        <IconPicker
          sprites={sprites}
          getUrl={getIconUrl}
          current={sel?.icon ?? ''}
          onPick={(name) => {
            if (sel) mutate((m) => { const n = findIn(m, sel.id); if (n) setFocusIcon(n.entry, name) })
            setShowPicker(false)
          }}
          onClose={() => setShowPicker(false)}
        />
      )}

      {condKey && sel && (
        <ConditionEditor
          blockKey={condKey}
          nodes={getFocusCondBlock(sel.entry, condKey) ?? []}
          newline={content.includes('\r\n') ? '\r\n' : '\n'}
          onApply={(ns) => {
            mutate((m) => {
              const n = findIn(m, sel.id)
              if (n) setFocusCondBlock(n.entry, condKey, ns)
            })
            setCondKey(null)
          }}
          onClose={() => setCondKey(null)}
        />
      )}

      {scCondIdx !== null && shortcuts[scCondIdx] && (
        <ConditionEditor
          blockKey="trigger"
          meta={{ zh: '显示条件', desc: '满足条件时该快捷路径（翻页按钮）才会显示在游戏内' }}
          nodes={getShortcutTrigger(shortcuts[scCondIdx].entry) ?? []}
          newline={content.includes('\r\n') ? '\r\n' : '\n'}
          onApply={(ns) => {
            mutate((m) => {
              const sc = getShortcuts(m.root)[scCondIdx]
              if (sc) setShortcutTrigger(sc.entry, ns)
            })
            setScCondIdx(null)
          }}
          onClose={() => setScCondIdx(null)}
        />
      )}
    </div>
  )
}
