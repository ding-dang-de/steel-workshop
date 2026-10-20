import { useEffect, useMemo, useRef, useState, useDeferredValue, useImperativeHandle } from 'react'
import type { OpenModInfo, ScanFile } from '../../../shared/types'
import { parseFile, serialize, countEntries } from '../../../shared/clausewitz'
import { extractFocusIds } from '../../../shared/localisation'
import { createEventsFile, extractEventIds } from '../../../shared/events'
import { loadFocusTree, getFocusFiredEvents } from '../../../shared/focusTree'
import { createDecisionsFile } from '../../../shared/decisions'
import { createIdeasFile } from '../../../shared/ideas'
import { createCharactersFile } from '../../../shared/characters'
import { createTraitsFile, extractTraitIds } from '../../../shared/traits'
import FocusEditor from './FocusEditor'
import LocalisationEditor from './LocalisationEditor'
import EventsEditor from './EventsEditor'
import DecisionsEditor from './DecisionsEditor'
import IdeasEditor from './IdeasEditor'
import CharactersEditor from './CharactersEditor'
import TraitsEditor from './TraitsEditor'
import GfxViewer from './GfxViewer'
import CheckPanel from './CheckPanel'
import type { CheckIssue } from '../../../shared/checks'
import { clampPaneSplit, PANE_SPLIT_DEFAULT } from '../../../shared/pane'

/** 可用 Clausewitz 解析器读取的扩展名（txt/yml/mod/gfx 都是同一种脚本格式） */
const PARSED_EXT = new Set(['txt', 'yml', 'mod', 'gfx'])
/** 纯文本直接编辑的扩展名 */
const PLAIN_EXT = new Set(['json', 'csv'])

function extOf(rel: string): string {
  return rel.split('.').pop()?.toLowerCase() ?? ''
}

function classify(rel: string): { ext: string; kind: 'txt' | 'yml'; parseable: boolean; editable: boolean } {
  const ext = extOf(rel)
  const parseable = PARSED_EXT.has(ext)
  const editable = parseable || PLAIN_EXT.has(ext)
  return { ext, kind: ext === 'yml' ? 'yml' : 'txt', parseable, editable }
}

/** 国策树文件（common/national_focus 下的 txt） */
function isFocusTreeFile(rel: string): boolean {
  return rel === 'common/national_focus.txt' || rel.startsWith('common/national_focus/')
}

/** 本地化文件（localisation/ 下的 yml） */
function isLocFile(rel: string): boolean {
  return rel.startsWith('localisation/')
}

/** 事件文件（events/ 下的 txt） */
function isEventFile(rel: string): boolean {
  return rel.startsWith('events/')
}

/** 决议文件（common/decisions/ 下的 txt；categories/ 子目录是分类元数据，按文本处理） */
function isDecisionFile(rel: string): boolean {
  return rel.startsWith('common/decisions/') && !rel.startsWith('common/decisions/categories/')
}

/** 民族精神文件（common/ideas/ 下的 txt） */
function isIdeaFile(rel: string): boolean {
  return rel.startsWith('common/ideas/')
}

/** 人物文件（common/characters/ 下的 txt） */
function isCharacterFile(rel: string): boolean {
  return rel.startsWith('common/characters/')
}

/** 领导人特质文件（common/country_leader/ 下的 txt） */
function isTraitFile(rel: string): boolean {
  return rel.startsWith('common/country_leader/')
}

/** 精灵定义文件（interface/ 下的 .gfx） */
function isGfxFile(rel: string): boolean {
  return extOf(rel) === 'gfx'
}

/** 字符串 → 事件命名空间（小写，非字母数字换成下划线） */
function sanitizeNs(name: string): string {
  const ns = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return ns || 'my_mod'
}

/** 事件命名空间：优先模组文件夹名（显示名可能是中文，没法当命名空间） */
function nsOfMod(m: OpenModInfo): string {
  const folder = m.path.split(/[\\/]/).pop() ?? ''
  const ns = sanitizeNs(folder)
  return ns !== 'my_mod' ? ns : sanitizeNs(m.name)
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// ---------- 文件树 ----------

interface DirNode {
  name: string
  dirs: Map<string, DirNode>
  files: ScanFile[]
}

function buildTree(files: ScanFile[]): DirNode {
  const root: DirNode = { name: '', dirs: new Map(), files: [] }
  for (const f of files) {
    const parts = f.rel.split('/')
    let node = root
    for (let i = 0; i < parts.length - 1; i++) {
      let child = node.dirs.get(parts[i])
      if (!child) {
        child = { name: parts[i], dirs: new Map(), files: [] }
        node.dirs.set(parts[i], child)
      }
      node = child
    }
    node.files.push(f)
  }
  return root
}

function sortTree(root: DirNode): void {
  root.files.sort((a, b) => a.rel.localeCompare(b.rel))
  for (const dir of root.dirs.values()) sortTree(dir)
}

/** 该分支（含子目录）在过滤词下是否有可见内容 */
function branchMatches(node: DirNode, filter: string): boolean {
  if (node.name.toLowerCase().includes(filter)) return true
  for (const f of node.files) if (f.rel.toLowerCase().includes(filter)) return true
  for (const d of node.dirs.values()) if (branchMatches(d, filter)) return true
  return false
}

interface BranchProps {
  node: DirNode
  depth: number
  expanded: Set<string>
  onToggle: (path: string) => void
  filter: string
  active: string | null
  /** 另一栏打开的文件路径（弱高亮，提示该文件已在另一栏打开） */
  secondary: string | null
  onOpen: (f: ScanFile) => void
  /** 整棵树共享的文件行渲染额度（大模组过滤时保护渲染性能，超出提示缩小范围） */
  budget: { left: number }
}

const MAX_VISIBLE_FILES = 500

function Branch(props: BranchProps): React.JSX.Element | null {
  const { node, depth, expanded, onToggle, filter, active, secondary, onOpen, budget } = props
  const f = filter.toLowerCase()
  const dirEntries = [...node.dirs.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  const visibleDirs = dirEntries.filter(([, d]) => !f || branchMatches(d, f))
  const visibleFiles = node.files.filter((file) => !f || file.rel.toLowerCase().includes(f))
  if (f && visibleDirs.length === 0 && visibleFiles.length === 0 && !node.name.toLowerCase().includes(f)) {
    return null
  }
  const take = Math.max(0, Math.min(budget.left, visibleFiles.length))
  budget.left -= take
  const shownFiles = visibleFiles.slice(0, take)
  return (
    <>
      {visibleDirs.map(([name, dir]) => {
        const isOpen = f ? true : expanded.has(name)
        return (
          <div key={name}>
            <button
              className="tree-row dir"
              style={{ paddingLeft: 8 + depth * 14 }}
              onClick={() => onToggle(name)}
            >
              <span className="tree-arrow">{isOpen ? '▾' : '▸'}</span>
              <span className="file-icon">📁</span>
              {name}
            </button>
            {isOpen && (
              <Branch
                node={dir}
                depth={depth + 1}
                expanded={expanded}
                onToggle={onToggle}
                filter={filter}
                active={active}
                secondary={secondary}
                onOpen={onOpen}
                budget={budget}
              />
            )}
          </div>
        )
      })}
      {shownFiles.map((file) => (
        <button
          key={file.rel}
          className={active === file.path ? 'tree-row active' : secondary === file.path ? 'tree-row other-pane' : 'tree-row'}
          style={{ paddingLeft: 8 + (depth + 1) * 14 }}
          title={file.rel}
          onClick={() => onOpen(file)}
        >
          <span className="file-icon">📄</span>
          <span className="file-name">{file.rel.split('/').pop()}</span>
          <span className="file-size">{fmtSize(file.size)}</span>
        </button>
      ))}
      {visibleFiles.length > take && (
        <div className="tree-row more" style={{ paddingLeft: 8 + (depth + 1) * 14 }}>
          …还有 {visibleFiles.length - take} 个文件（继续输入关键字缩小范围）
        </div>
      )}
    </>
  )
}

// ---------- 主组件 ----------

type EditorMode = 'canvas' | 'loc' | 'events' | 'decisions' | 'ideas' | 'characters' | 'traits' | 'gfx' | 'text'

/** 无损统计（内容变化 150ms 防抖后重算） */
interface FileStats {
  entries: number
  errors: { line: number; col: number; message: string }[]
  roundtrip: boolean
  newline: string
  bom: boolean
}

/** 单栏的跳转目标（token 变化才重新定位；token 全局递增保证跨栏唯一） */
interface PaneJumps {
  locJump: { key: string; autofill: boolean; keyOnly: boolean; token: number } | null
  eventJump: { id: string; autofill: boolean; token: number } | null
  focusJump: { id: string; token: number } | null
}

/** 一栏的完整状态（双栏分屏：左右各一份，互不干扰） */
interface PaneState extends PaneJumps {
  file: ScanFile | null
  content: string | null
  loadError: string
  saved: string
  saving: boolean
  editorMode: EditorMode
  stats: FileStats | null
}

const emptyPane = (): PaneState => ({
  file: null,
  content: null,
  loadError: '',
  saved: '',
  saving: false,
  editorMode: 'canvas',
  stats: null,
  locJump: null,
  eventJump: null,
  focusJump: null
})

/** 由 ModView 暴露给 App：返回项目管理前确认未保存修改 */
export interface ModViewHandle {
  confirmClose(): boolean
}

interface Props {
  mod: OpenModInfo
  gameDir: string | null
  /** 双栏分屏左栏比例（来自设置；拖动结束后经 onPaneSplitChange 回写） */
  paneSplit: number
  onPaneSplitChange?: (v: number) => void
  ref?: React.Ref<ModViewHandle>
}

export default function ModView({ mod, gameDir, paneSplit, onPaneSplitChange, ref }: Props): React.JSX.Element {
  /** 本地模组信息副本：新建事件文件后重新扫描并替换，文件树随之刷新 */
  const [modInfo, setModInfo] = useState<OpenModInfo>(mod)
  const modInfoRef = useRef<OpenModInfo>(mod)
  useEffect(() => {
    setModInfo(mod)
    modInfoRef.current = mod
    eventLinkCacheRef.current = null
  }, [mod])
  const [filter, setFilter] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  /** 双栏状态（左 0 / 右 1，固定两栏非标签页） */
  const [panes, setPanes] = useState<[PaneState, PaneState]>([emptyPane(), emptyPane()])
  const [activePane, setActivePane] = useState<0 | 1>(0)
  const activePaneRef = useRef<0 | 1>(0)
  /** 双栏分屏左栏比例（拖动分隔条调整；初始值来自设置） */
  const [split, setSplit] = useState(() => clampPaneSplit(paneSplit))
  const [splitDragging, setSplitDragging] = useState(false)
  /** 拖动中状态：起点坐标 + 起点比例（分隔条按下时记录，指针抬起清空） */
  const splitDragRef = useRef<{ startX: number; startSplit: number } | null>(null)
  const splitWrapRef = useRef<HTMLDivElement | null>(null)
  /** 每栏未保存状态（保持 ref：dirty 变化不触发重渲染，编辑器内部自管显示） */
  const dirtyRefs = useRef<[boolean, boolean]>([false, false])
  /** panes 实时镜像（异步读盘返回后校验该栏未被切换/关闭） */
  const panesRef = useRef(panes)
  useEffect(() => {
    panesRef.current = panes
  }, [panes])

  /** 合并更新某栏状态（panesRef 由上面的 effect 同步） */
  const patchPane = (idx: 0 | 1, patch: Partial<PaneState>): void => {
    setPanes((prev) => {
      const next: [PaneState, PaneState] = [prev[0], prev[1]]
      next[idx] = { ...prev[idx], ...patch }
      return next
    })
  }

  /** 切换激活栏（ref 同步给异步回调与 keydown 路由用） */
  const activate = (i: 0 | 1): void => {
    if (activePaneRef.current === i) return
    activePaneRef.current = i
    setActivePane(i)
  }

  /** 提交左栏比例：更新界面 + 写进设置持久化（拖动结束/键盘/双击才调用，避免拖动过程高频写盘） */
  const commitSplit = (v: number): void => {
    const next = clampPaneSplit(v)
    setSplit(next)
    void window.api.setSettings({ paneSplit: next })
    onPaneSplitChange?.(next)
  }

  /** 分隔条按下：记录起点并挂 window 级监听（不用 setPointerCapture——合成事件没有活动指针会抛异常） */
  const onDividerPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    splitDragRef.current = { startX: e.clientX, startSplit: split }
    setSplitDragging(true)
    const move = (ev: PointerEvent): void => {
      const d = splitDragRef.current
      const wrap = splitWrapRef.current
      if (!d || !wrap || wrap.clientWidth <= 0) return
      setSplit(clampPaneSplit(d.startSplit + (ev.clientX - d.startX) / wrap.clientWidth))
    }
    const up = (ev: PointerEvent): void => {
      const d = splitDragRef.current
      if (!d) return
      splitDragRef.current = null
      setSplitDragging(false)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      const wrap = splitWrapRef.current
      commitSplit(wrap && wrap.clientWidth > 0 ? clampPaneSplit(d.startSplit + (ev.clientX - d.startX) / wrap.clientWidth) : d.startSplit)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  /** 键盘微调（左右键 ±5%）；双击恢复对半走 onDoubleClick */
  const onDividerKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      commitSplit(split - 0.05)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      commitSplit(split + 0.05)
    }
  }

  /** 编辑器类型的显示名（切文本模式的确认文案用） */
  const editorLabel = (p: PaneState): string => {
    if (!p.file) return '编辑器'
    if (isFocusTreeFile(p.file.rel)) return '画布'
    if (isLocFile(p.file.rel)) return '本地化编辑器'
    if (isEventFile(p.file.rel)) return '事件编辑器'
    if (isDecisionFile(p.file.rel)) return '决议编辑器'
    if (isIdeaFile(p.file.rel)) return '民族精神编辑器'
    if (isCharacterFile(p.file.rel)) return '人物编辑器'
    if (isTraitFile(p.file.rel)) return '特质编辑器'
    return '编辑器'
  }

  /** 切换编辑器模式；结构化 → 文本且有未保存修改时确认（文本 → 结构化无需确认，文本修改保留在 content 里） */
  const setMode = (idx: 0 | 1, mode: EditorMode): void => {
    const p = panesRef.current[idx]
    if (mode === 'text' && p.editorMode !== 'text' && dirtyRefs.current[idx]) {
      if (!window.confirm(`${editorLabel(p)}有未保存的修改，切到文本模式会丢失这些修改，确定继续？`)) return
    }
    patchPane(idx, { editorMode: mode })
  }

  /** 关闭某栏：有未保存修改先确认；关的是激活栏则激活切到另一栏 */
  const closePane = (idx: 0 | 1): void => {
    if (dirtyRefs.current[idx] && !window.confirm('当前栏有未保存的修改，确定关闭？')) return
    dirtyRefs.current[idx] = false
    patchPane(idx, emptyPane())
    if (activePaneRef.current === idx) activate(idx === 0 ? 1 : 0)
  }

  const [locFocusIds, setLocFocusIds] = useState<string[] | null>(null)
  /** 国策 id 列表按模组缓存（本地化编辑器联动用） */
  const locIdsCacheRef = useRef<{ modPath: string; ids: string[] } | null>(null)
  /** 领导人特质 id 列表按模组缓存（人物编辑器 traits 补全用）；null 表示正在读取 */
  const [traitIds, setTraitIds] = useState<string[] | null>(null)
  const traitIdsCacheRef = useRef<{ modPath: string; ids: string[] } | null>(null)
  /** 跳转 token 全局递增（各栏跳转目标存在 pane 内，token 跨栏唯一） */
  const jumpTokenRef = useRef(0)
  /** 事件联动数据（按模组缓存）：事件文件列表 / 全部事件 id / 国策完成效果里触发的事件引用 */
  const [eventFiles, setEventFiles] = useState<{ path: string; rel: string }[] | null>(null)
  const [eventIds, setEventIds] = useState<string[] | null>(null)
  const [eventRefs, setEventRefs] = useState<{ eventId: string; focusId: string; fileRel: string }[] | null>(null)
  const eventLinkCacheRef = useRef<{
    modPath: string
    eventFiles: { path: string; rel: string }[]
    eventIds: string[]
    eventRefs: { eventId: string; focusId: string; fileRel: string }[]
  } | null>(null)
  const eventLinkInflightRef = useRef<{ modPath: string; promise: Promise<void> } | null>(null)
  /** 新建事件文件表单 */
  const [showNewEventForm, setShowNewEventForm] = useState(false)
  const [newEventFileName, setNewEventFileName] = useState('')
  const [creatingFile, setCreatingFile] = useState(false)
  /** 新建决议文件表单 */
  const [showNewDecForm, setShowNewDecForm] = useState(false)
  const [newDecFileName, setNewDecFileName] = useState('')
  const [creatingDecFile, setCreatingDecFile] = useState(false)
  /** 新建民族精神文件表单 */
  const [showNewIdeaForm, setShowNewIdeaForm] = useState(false)
  const [newIdeaFileName, setNewIdeaFileName] = useState('')
  const [creatingIdeaFile, setCreatingIdeaFile] = useState(false)
  /** 新建人物文件表单 */
  const [showNewCharForm, setShowNewCharForm] = useState(false)
  const [newCharFileName, setNewCharFileName] = useState('')
  const [creatingCharFile, setCreatingCharFile] = useState(false)
  /** 新建特质文件表单 */
  const [showNewTraitForm, setShowNewTraitForm] = useState(false)
  const [newTraitFileName, setNewTraitFileName] = useState('')
  const [creatingTraitFile, setCreatingTraitFile] = useState(false)
  const [fileMsg, setFileMsg] = useState('')
  /** 模组检查面板 */
  const [showChecks, setShowChecks] = useState(false)

  const locFiles = useMemo(() => modInfo.files.filter((f) => isLocFile(f.rel)).map((f) => ({ path: f.path, rel: f.rel })), [modInfo])

  const tree = useMemo(() => {
    const t = buildTree(modInfo.files)
    sortTree(t)
    return t
  }, [modInfo])

  /** 树过滤用延迟值：宽过滤几千文件时输入不被渲染拖慢 */
  const deferredFilter = useDeferredValue(filter)
  /** 无损统计：内容变化 150ms 后重算（大文件输入不阻塞按键）；按栏独立防抖。
   *  deps 只盯两栏的 file/content（stats 回写不重触发定时器，避免 150ms 周期死循环） */
  const statsTimersRef = useRef<[number | undefined, number | undefined]>([undefined, undefined])
  useEffect(() => {
    const cur = panesRef.current
    for (const i of [0, 1] as const) {
      window.clearTimeout(statsTimersRef.current[i])
      const f = cur[i].file
      const content = cur[i].content
      statsTimersRef.current[i] = window.setTimeout(() => {
        if (!content || !f) {
          patchPane(i, { stats: null })
          return
        }
        const c = classify(f.rel)
        if (!c.parseable) {
          patchPane(i, { stats: null })
          return
        }
        const { file: cw, errors } = parseFile(content, c.kind)
        patchPane(i, {
          stats: {
            entries: cw ? countEntries(cw.items) : 0,
            errors,
            roundtrip: cw ? serialize(cw) === content : false,
            newline: cw?.newline === '\r\n' ? 'CRLF' : 'LF',
            bom: content.startsWith('﻿')
          }
        })
      }, 150)
    }
    return () => {
      window.clearTimeout(statsTimersRef.current[0])
      window.clearTimeout(statsTimersRef.current[1])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panes[0].file, panes[0].content, panes[1].file, panes[1].content])

  const toggle = (name: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  /** 扫描事件联动数据：事件文件列表、全部事件 id、国策完成效果里触发的事件引用（按模组缓存） */
  const loadEventLink = (): void => {
    const mi = modInfoRef.current
    const cached = eventLinkCacheRef.current
    if (cached && cached.modPath === mi.path) {
      setEventFiles(cached.eventFiles)
      setEventIds(cached.eventIds)
      setEventRefs(cached.eventRefs)
      return
    }
    const inflight = eventLinkInflightRef.current
    if (inflight && inflight.modPath === mi.path) return
    setEventFiles(null)
    setEventIds(null)
    setEventRefs(null)
    const promise = (async () => {
      const ef = mi.files.filter((f) => isEventFile(f.rel)).map((f) => ({ path: f.path, rel: f.rel }))
      const ids: string[] = []
      for (const f of ef) {
        try {
          ids.push(...extractEventIds(await window.api.readTextFile(f.path)))
        } catch {
          // 单个文件读取失败就跳过
        }
      }
      const refs: { eventId: string; focusId: string; fileRel: string }[] = []
      for (const tf of mi.files) {
        if (!isFocusTreeFile(tf.rel)) continue
        try {
          const model = loadFocusTree(await window.api.readTextFile(tf.path))
          if (!model) continue
          for (const n of model.nodes) {
            for (const r of getFocusFiredEvents(n.entry)) refs.push({ eventId: r.id, focusId: n.id, fileRel: tf.rel })
          }
        } catch {
          // 单个文件读取失败就跳过
        }
      }
      eventLinkCacheRef.current = { modPath: mi.path, eventFiles: ef, eventIds: ids, eventRefs: refs }
      setEventFiles(ef)
      setEventIds(ids)
      setEventRefs(refs)
    })()
    eventLinkInflightRef.current = { modPath: mi.path, promise }
    void promise.finally(() => {
      if (eventLinkInflightRef.current?.promise === promise) eventLinkInflightRef.current = null
    })
  }

  /** 使事件联动缓存失效并重新扫描（画布/事件编辑器保存后磁盘内容已变） */
  const refreshEventLink = async (): Promise<void> => {
    // 先等旧扫描结束再重扫：旧扫描拿的是旧文件列表，直接重扫会被 in-flight 去重吞掉
    const mi = modInfoRef.current
    const inflight = eventLinkInflightRef.current
    if (inflight && inflight.modPath === mi.path) {
      try {
        await inflight.promise
      } catch {
        // 扫描失败可忽略
      }
    }
    eventLinkInflightRef.current = null
    eventLinkCacheRef.current = null
    loadEventLink()
  }

  /** 打开跳转参数（token 全局递增，保证每次跳转都触发定位 effect） */
  const jumpPatchOf = (
    opts:
      | {
          jumpKey?: string
          autofill?: boolean
          autofillKeyOnly?: boolean
          eventJumpId?: string
          eventAutofill?: boolean
          focusJumpId?: string
        }
      | undefined,
    patch: Partial<PaneState>
  ): void => {
    if (!opts) return
    if (opts.jumpKey) {
      jumpTokenRef.current += 1
      patch.locJump = { key: opts.jumpKey, autofill: opts.autofill ?? false, keyOnly: opts.autofillKeyOnly ?? false, token: jumpTokenRef.current }
    }
    if (opts.eventJumpId) {
      jumpTokenRef.current += 1
      patch.eventJump = { id: opts.eventJumpId, autofill: opts.eventAutofill ?? false, token: jumpTokenRef.current }
    }
    if (opts.focusJumpId) {
      jumpTokenRef.current += 1
      patch.focusJump = { id: opts.focusJumpId, token: jumpTokenRef.current }
    }
  }

  /** 在指定栏打开文件（读盘是异步的，返回后校验该栏未被切换/关闭，防迟到结果复活旧文件） */
  const openFile = async (
    paneIdx: 0 | 1,
    f: ScanFile,
    opts?: {
      jumpKey?: string
      autofill?: boolean
      autofillKeyOnly?: boolean
      eventJumpId?: string
      eventAutofill?: boolean
      focusJumpId?: string
    }
  ): Promise<void> => {
    if (dirtyRefs.current[paneIdx] && !window.confirm(`当前栏有未保存的修改，确定放弃并打开「${f.rel}」？`)) return
    dirtyRefs.current[paneIdx] = false
    patchPane(paneIdx, {
      file: f,
      content: null,
      loadError: '',
      saved: '',
      saving: false,
      stats: null,
      editorMode: isFocusTreeFile(f.rel)
        ? 'canvas'
        : isLocFile(f.rel)
          ? 'loc'
          : isEventFile(f.rel)
            ? 'events'
            : isDecisionFile(f.rel)
              ? 'decisions'
              : isIdeaFile(f.rel)
                ? 'ideas'
                : isCharacterFile(f.rel)
                  ? 'characters'
                  : isTraitFile(f.rel)
                    ? 'traits'
                    : isGfxFile(f.rel)
                      ? 'gfx'
                      : 'text',
      locJump: null,
      eventJump: null,
      focusJump: null
    })
    let text: string
    try {
      text = await window.api.readTextFile(f.path)
    } catch (err) {
      patchPane(paneIdx, { loadError: err instanceof Error ? err.message : String(err) })
      return
    }
    // await 期间该栏可能被关闭或换了文件：迟到结果作废
    if (panesRef.current[paneIdx].file?.path !== f.path) return
    // 跳转目标与 content 同一批设置，保证定位 effect 拿到的是新文件
    const patch: Partial<PaneState> = { content: text }
    jumpPatchOf(opts, patch)
    patchPane(paneIdx, patch)
    // 国策/事件编辑器联动：扫描事件文件与国策完成效果里的事件引用（按模组缓存）
    if (isFocusTreeFile(f.rel) || isEventFile(f.rel)) loadEventLink()
    // 本地化/事件/决议/精神/人物/特质编辑器联动：读取模组内全部国策树的国策 id（按模组缓存）
    if (
      isLocFile(f.rel) ||
      isEventFile(f.rel) ||
      isDecisionFile(f.rel) ||
      isIdeaFile(f.rel) ||
      isCharacterFile(f.rel) ||
      isTraitFile(f.rel)
    ) {
      const mi = modInfoRef.current
      const cached = locIdsCacheRef.current
      if (cached && cached.modPath === mi.path) {
        setLocFocusIds(cached.ids)
      } else {
        setLocFocusIds(null)
        void (async () => {
          const ids = new Set<string>()
          for (const tf of mi.files) {
            if (!isFocusTreeFile(tf.rel)) continue
            try {
              for (const id of extractFocusIds(await window.api.readTextFile(tf.path))) ids.add(id)
            } catch {
              // 单个文件读取失败就跳过
            }
          }
          const list = [...ids]
          locIdsCacheRef.current = { modPath: mi.path, ids: list }
          setLocFocusIds(list)
        })()
      }
    }
    // 人物编辑器联动：读取模组内全部领导人特质 id 供 traits 自动补全（按模组缓存）
    if (isCharacterFile(f.rel)) {
      const mi = modInfoRef.current
      const cached = traitIdsCacheRef.current
      if (cached && cached.modPath === mi.path) {
        setTraitIds(cached.ids)
      } else {
        setTraitIds(null)
        void (async () => {
          const ids = new Set<string>()
          for (const tf of mi.files) {
            if (!isTraitFile(tf.rel)) continue
            try {
              for (const id of extractTraitIds(await window.api.readTextFile(tf.path))) ids.add(id)
            } catch {
              // 单个文件读取失败就跳过
            }
          }
          const list = [...ids]
          traitIdsCacheRef.current = { modPath: mi.path, ids: list }
          setTraitIds(list)
        })()
      }
    }
  }

  /**
   * 联动跳转路由（画布/事件/决议等编辑器里点「编辑本地化」「跳转到国策」等）：
   * 目标文件已在某栏打开 → 原地跳转并激活该栏（不重读、不 confirm、不丢未保存修改）；
   * 否则空闲栏优先打开（画布留在原栏，实现「同时编辑」），两栏都满则开在来源栏（自带 confirm）。
   */
  const openOrJump = (
    f: ScanFile,
    opts:
      | {
          jumpKey?: string
          autofill?: boolean
          autofillKeyOnly?: boolean
          eventJumpId?: string
          eventAutofill?: boolean
          focusJumpId?: string
        }
      | undefined,
    fromPaneIdx: 0 | 1
  ): void => {
    for (const i of [0, 1] as const) {
      if (panesRef.current[i].file?.path === f.path) {
        if (opts) {
          const patch: Partial<PaneState> = {}
          jumpPatchOf(opts, patch)
          patchPane(i, patch)
        }
        activate(i)
        return
      }
    }
    const target: 0 | 1 = panesRef.current[0].file === null ? 0 : panesRef.current[1].file === null ? 1 : fromPaneIdx
    void openFile(target, f, opts)
    activate(target)
  }

  /**
   * 创建（或复用）events/ 下的文件：已存在直接返回；否则写模板 → 重新扫描模组。
   * 国策联动的一键添加在模组没有事件文件时也会走这里（模板自带命名空间和一个示例事件）。
   */
  const createEventFileByName = async (name: string): Promise<ScanFile | null> => {
    const mi = modInfoRef.current
    const rel = `events/${name}`
    const existing = mi.files.find((x) => x.rel.toLowerCase() === rel.toLowerCase())
    if (existing) return existing
    if (!/^[A-Za-z0-9_.-]+$/.test(name)) {
      setFileMsg('文件名只能包含字母、数字、下划线、点和连字符')
      return null
    }
    setCreatingFile(true)
    try {
      const text = createEventsFile(nsOfMod(mi), '\n')
      const full = `${mi.path.replace(/[\\/]+$/, '')}\\events\\${name}`
      await window.api.writeTextFile(full, text)
      const info = await window.api.openMod(mi.path)
      setModInfo(info)
      modInfoRef.current = info
      void refreshEventLink()
      return info.files.find((x) => x.rel.toLowerCase() === rel.toLowerCase()) ?? null
    } catch (err) {
      setFileMsg(`创建失败：${err instanceof Error ? err.message : String(err)}`)
      return null
    } finally {
      setCreatingFile(false)
    }
  }

  /** 新建事件文件表单：写模板 → 重新扫描模组 → 直接打开新文件 */
  const createNewEventFile = async (): Promise<void> => {
    const name = newEventFileName.trim()
    if (!name || creatingFile) return
    if (modInfo.files.some((x) => x.rel.toLowerCase() === `events/${name.toLowerCase()}`)) {
      setFileMsg('同名文件已存在，请换一个名字')
      return
    }
    const f = await createEventFileByName(name)
    if (f) {
      setShowNewEventForm(false)
      setFileMsg('')
      openOrJump(f, undefined, activePaneRef.current)
    }
  }

  /** 新建决议文件：写模板 → 重新扫描模组 → 直接打开新文件 */
  const createNewDecisionFile = async (): Promise<void> => {
    const name = newDecFileName.trim()
    if (!name || creatingDecFile) return
    if (!/^[A-Za-z0-9_.-]+$/.test(name)) {
      setFileMsg('文件名只能包含字母、数字、下划线、点和连字符')
      return
    }
    const rel = `common/decisions/${name}`
    if (modInfo.files.some((x) => x.rel.toLowerCase() === rel.toLowerCase())) {
      setFileMsg('同名文件已存在，请换一个名字')
      return
    }
    setCreatingDecFile(true)
    try {
      const text = createDecisionsFile(nsOfMod(modInfo))
      const full = `${modInfo.path.replace(/[\\/]+$/, '')}\\common\\decisions\\${name}`
      await window.api.writeTextFile(full, text)
      const info = await window.api.openMod(modInfo.path)
      setModInfo(info)
      modInfoRef.current = info
      setShowNewDecForm(false)
      setFileMsg('')
      const f = info.files.find((x) => x.rel.toLowerCase() === rel.toLowerCase())
      if (f) openOrJump(f, undefined, activePaneRef.current)
    } catch (err) {
      setFileMsg(`创建失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setCreatingDecFile(false)
    }
  }

  /** 新建民族精神文件：写模板 → 重新扫描模组 → 直接打开新文件 */
  const createNewIdeasFile = async (): Promise<void> => {
    const name = newIdeaFileName.trim()
    if (!name || creatingIdeaFile) return
    if (!/^[A-Za-z0-9_.-]+$/.test(name)) {
      setFileMsg('文件名只能包含字母、数字、下划线、点和连字符')
      return
    }
    const rel = `common/ideas/${name}`
    if (modInfo.files.some((x) => x.rel.toLowerCase() === rel.toLowerCase())) {
      setFileMsg('同名文件已存在，请换一个名字')
      return
    }
    setCreatingIdeaFile(true)
    try {
      const text = createIdeasFile(nsOfMod(modInfo))
      const full = `${modInfo.path.replace(/[\\/]+$/, '')}\\common\\ideas\\${name}`
      await window.api.writeTextFile(full, text)
      const info = await window.api.openMod(modInfo.path)
      setModInfo(info)
      modInfoRef.current = info
      setShowNewIdeaForm(false)
      setFileMsg('')
      const f = info.files.find((x) => x.rel.toLowerCase() === rel.toLowerCase())
      if (f) openOrJump(f, undefined, activePaneRef.current)
    } catch (err) {
      setFileMsg(`创建失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setCreatingIdeaFile(false)
    }
  }

  /** 新建人物文件：写模板 → 重新扫描模组 → 直接打开新文件 */
  const createNewCharactersFile = async (): Promise<void> => {
    const name = newCharFileName.trim()
    if (!name || creatingCharFile) return
    if (!/^[A-Za-z0-9_.-]+$/.test(name)) {
      setFileMsg('文件名只能包含字母、数字、下划线、点和连字符')
      return
    }
    const rel = `common/characters/${name}`
    if (modInfo.files.some((x) => x.rel.toLowerCase() === rel.toLowerCase())) {
      setFileMsg('同名文件已存在，请换一个名字')
      return
    }
    setCreatingCharFile(true)
    try {
      const text = createCharactersFile(nsOfMod(modInfo), '\n')
      const full = `${modInfo.path.replace(/[\\/]+$/, '')}\\common\\characters\\${name}`
      await window.api.writeTextFile(full, text)
      const info = await window.api.openMod(modInfo.path)
      setModInfo(info)
      modInfoRef.current = info
      setShowNewCharForm(false)
      setFileMsg('')
      const f = info.files.find((x) => x.rel.toLowerCase() === rel.toLowerCase())
      if (f) openOrJump(f, undefined, activePaneRef.current)
    } catch (err) {
      setFileMsg(`创建失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setCreatingCharFile(false)
    }
  }

  /** 新建特质文件：写模板 → 重新扫描模组 → 直接打开新文件 */
  const createNewTraitsFile = async (): Promise<void> => {
    const name = newTraitFileName.trim()
    if (!name || creatingTraitFile) return
    if (!/^[A-Za-z0-9_.-]+$/.test(name)) {
      setFileMsg('文件名只能包含字母、数字、下划线、点和连字符')
      return
    }
    const rel = `common/country_leader/${name}`
    if (modInfo.files.some((x) => x.rel.toLowerCase() === rel.toLowerCase())) {
      setFileMsg('同名文件已存在，请换一个名字')
      return
    }
    setCreatingTraitFile(true)
    try {
      const text = createTraitsFile(nsOfMod(modInfo), '\n')
      const full = `${modInfo.path.replace(/[\\/]+$/, '')}\\common\\country_leader\\${name}`
      await window.api.writeTextFile(full, text)
      const info = await window.api.openMod(modInfo.path)
      setModInfo(info)
      modInfoRef.current = info
      setShowNewTraitForm(false)
      setFileMsg('')
      const f = info.files.find((x) => x.rel.toLowerCase() === rel.toLowerCase())
      if (f) openOrJump(f, undefined, activePaneRef.current)
    } catch (err) {
      setFileMsg(`创建失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setCreatingTraitFile(false)
    }
  }

  /** 保存某栏当前内容到磁盘（文本模式专用；结构化编辑器自己写盘后回调 onSaved） */
  const save = async (idx: 0 | 1): Promise<void> => {
    const p = panesRef.current[idx]
    if (!p.file || p.content === null || p.saving) return
    patchPane(idx, { saving: true })
    try {
      const { backedUp } = await window.api.writeTextFile(p.file.path, p.content)
      dirtyRefs.current[idx] = false
      patchPane(idx, { saved: backedUp ? '已保存（原文件已备份）' : '已保存' })
    } catch (err) {
      patchPane(idx, { saved: `保存失败：${err instanceof Error ? err.message : String(err)}` })
    } finally {
      patchPane(idx, { saving: false })
    }
  }

  /** 检查面板点击问题条目：缺失本地化键跳到第一个 loc 文件并定位该键，其余跳到问题所在文件 */
  const openIssue = (issue: CheckIssue): void => {
    setShowChecks(false)
    if (issue.kind === 'loc-missing') {
      const locF = modInfo.files.find((x) => isLocFile(x.rel))
      if (locF) openOrJump(locF, { jumpKey: issue.subject, autofill: true }, activePaneRef.current)
      return
    }
    const f = modInfo.files.find((x) => x.rel === issue.file)
    if (f) openOrJump(f, undefined, activePaneRef.current)
  }

  /** 返回项目管理前确认：任一栏有未保存修改时弹窗（App 通过 ref 调用） */
  useImperativeHandle(ref, () => ({
    confirmClose: (): boolean => {
      if (dirtyRefs.current[0] || dirtyRefs.current[1]) {
        return window.confirm('有未保存的修改，确定返回项目管理？')
      }
      return true
    }
  }))

  /** 渲染一栏（内联函数而非子组件：与头部按钮/保存/跳转闭包共享状态，抽组件需 ~20 个 prop） */
  const renderPane = (idx: 0 | 1): React.JSX.Element => {
    const p = panes[idx]
    if (!p.file) {
      return (
        <div className="viewer-empty">
          <p className="viewer-empty-title">{idx === 0 ? '左栏' : '右栏'}为空</p>
          <p className="viewer-empty-note">
            点击本栏将其激活，再从左侧文件树选择文件即可在本栏打开；画布/事件等编辑器里的联动跳转会自动使用空闲的一栏，实现两个文件同时编辑。
          </p>
        </div>
      )
    }
    const f = p.file
    const cls = classify(f.rel)
    return (
      <>
        <div className="viewer-head">
          <div className="viewer-title-row">
            <span className="viewer-title">{f.rel}</span>
            <span className="file-size">{fmtSize(f.size)}</span>
            {cls.parseable && p.stats && (
              <>
                <span className="badge-stats info">{p.stats.entries} 个条目</span>
                <span className="badge-stats info">{p.stats.newline}</span>
                <span className="badge-stats info">{p.stats.bom ? '带 BOM' : '无 BOM'}</span>
              </>
            )}
            {p.stats && p.stats.errors.length > 0 && <span className="badge-stats warn">⚠ {p.stats.errors.length} 处解析异常</span>}
          </div>
          <div className="viewer-actions">
            {cls.parseable && p.stats && (
              <span className={p.stats.roundtrip ? 'badge-stats ok' : 'badge-stats warn'} title="解析后重新序列化，与原文逐字节比较">
                {p.stats.roundtrip ? '✅ 无损往返一致' : '❌ 往返存在差异'}
              </span>
            )}
            {cls.editable && isFocusTreeFile(f.rel) && (
              <div className="fe-mode-toggle">
                <button className={p.editorMode === 'canvas' ? 'btn small primary' : 'btn small'} onClick={() => setMode(idx, 'canvas')}>
                  画布
                </button>
                <button className={p.editorMode === 'text' ? 'btn small primary' : 'btn small'} onClick={() => setMode(idx, 'text')}>
                  文本
                </button>
              </div>
            )}
            {cls.editable && isLocFile(f.rel) && (
              <div className="fe-mode-toggle">
                <button className={p.editorMode === 'loc' ? 'btn small primary' : 'btn small'} onClick={() => setMode(idx, 'loc')}>
                  表格
                </button>
                <button className={p.editorMode === 'text' ? 'btn small primary' : 'btn small'} onClick={() => setMode(idx, 'text')}>
                  文本
                </button>
              </div>
            )}
            {cls.editable && isEventFile(f.rel) && (
              <div className="fe-mode-toggle">
                <button className={p.editorMode === 'events' ? 'btn small primary' : 'btn small'} onClick={() => setMode(idx, 'events')}>
                  事件
                </button>
                <button className={p.editorMode === 'text' ? 'btn small primary' : 'btn small'} onClick={() => setMode(idx, 'text')}>
                  文本
                </button>
              </div>
            )}
            {cls.editable && isDecisionFile(f.rel) && (
              <div className="fe-mode-toggle">
                <button className={p.editorMode === 'decisions' ? 'btn small primary' : 'btn small'} onClick={() => setMode(idx, 'decisions')}>
                  决议
                </button>
                <button className={p.editorMode === 'text' ? 'btn small primary' : 'btn small'} onClick={() => setMode(idx, 'text')}>
                  文本
                </button>
              </div>
            )}
            {cls.editable && isIdeaFile(f.rel) && (
              <div className="fe-mode-toggle">
                <button className={p.editorMode === 'ideas' ? 'btn small primary' : 'btn small'} onClick={() => setMode(idx, 'ideas')}>
                  精神
                </button>
                <button className={p.editorMode === 'text' ? 'btn small primary' : 'btn small'} onClick={() => setMode(idx, 'text')}>
                  文本
                </button>
              </div>
            )}
            {cls.editable && isCharacterFile(f.rel) && (
              <div className="fe-mode-toggle">
                <button className={p.editorMode === 'characters' ? 'btn small primary' : 'btn small'} onClick={() => setMode(idx, 'characters')}>
                  人物
                </button>
                <button className={p.editorMode === 'text' ? 'btn small primary' : 'btn small'} onClick={() => setMode(idx, 'text')}>
                  文本
                </button>
              </div>
            )}
            {cls.editable && isTraitFile(f.rel) && (
              <div className="fe-mode-toggle">
                <button className={p.editorMode === 'traits' ? 'btn small primary' : 'btn small'} onClick={() => setMode(idx, 'traits')}>
                  特质
                </button>
                <button className={p.editorMode === 'text' ? 'btn small primary' : 'btn small'} onClick={() => setMode(idx, 'text')}>
                  文本
                </button>
              </div>
            )}
            {cls.editable && isGfxFile(f.rel) && (
              <div className="fe-mode-toggle">
                <button className={p.editorMode === 'gfx' ? 'btn small primary' : 'btn small'} onClick={() => setMode(idx, 'gfx')}>
                  精灵
                </button>
                <button className={p.editorMode === 'text' ? 'btn small primary' : 'btn small'} onClick={() => setMode(idx, 'text')}>
                  文本
                </button>
              </div>
            )}
            {cls.editable && p.editorMode === 'text' && (
              <>
                <button className="btn small" disabled={p.content === null} onClick={() => void openFile(idx, f)}>
                  还原
                </button>
                <button className="btn small primary" disabled={p.content === null || p.saving} onClick={() => void save(idx)}>
                  {p.saving ? '保存中…' : '保存'}
                </button>
              </>
            )}
            <button className="btn tiny pane-close" title="关闭本栏（有未保存修改时会先确认）" onClick={() => closePane(idx)}>
              ✕ 关闭
            </button>
          </div>
        </div>

        {p.stats && p.stats.errors.length > 0 && (
          <div className="parse-errors">
            {p.stats.errors.slice(0, 5).map((e, i) => (
              <div key={i} className="parse-error-line">
                第 {e.line} 行第 {e.col} 列：{e.message}
              </div>
            ))}
            {p.stats.errors.length > 5 && <div className="parse-error-line">…共 {p.stats.errors.length} 处</div>}
          </div>
        )}

        {p.saved && <div className="save-note">{p.saved}</div>}

        {p.loadError ? (
          <div className="load-error">{p.loadError}</div>
        ) : p.content === null ? (
          <div className="viewer-empty">正在读取…</div>
        ) : cls.editable && cls.kind === 'txt' && isFocusTreeFile(f.rel) && p.editorMode === 'canvas' ? (
          <FocusEditor
            path={f.path}
            content={p.content}
            gameDir={gameDir}
            modPath={modInfo.path}
            locFiles={locFiles}
            eventFiles={eventFiles ?? []}
            eventIds={eventIds}
            eventNamespace={nsOfMod(modInfo)}
            active={idx === activePane}
            onOpenEvent={(eventId, eventPath, autofill) => {
              if (eventPath) {
                const ef = modInfo.files.find((x) => x.path === eventPath)
                if (ef) {
                  openOrJump(ef, { eventJumpId: eventId, eventAutofill: autofill }, idx)
                  return
                }
              }
              // 模组里还没有事件文件：自动创建 events/<命名空间>_events.txt（模板自带示例事件）后跳转
              void createEventFileByName(`${nsOfMod(modInfo)}_events.txt`).then((ef) => {
                if (ef) openOrJump(ef, { eventJumpId: eventId, eventAutofill: autofill }, activePaneRef.current)
              })
            }}
            jumpId={p.focusJump?.id ?? null}
            jumpToken={p.focusJump?.token ?? 0}
            onOpenLoc={(focusId, locPath, autofill, keyOnly) => {
              const lf = modInfo.files.find((x) => x.path === locPath)
              if (lf) openOrJump(lf, { jumpKey: focusId, autofill, autofillKeyOnly: keyOnly }, idx)
            }}
            onSaved={(text) => {
              patchPane(idx, { content: text, saved: '' })
              void refreshEventLink()
            }}
            onUnsavedChange={(dirty) => {
              dirtyRefs.current[idx] = dirty
            }}
          />
        ) : cls.editable && isLocFile(f.rel) && p.editorMode === 'loc' ? (
          <LocalisationEditor
            path={f.path}
            content={p.content}
            focusIds={locFocusIds}
            jumpKey={p.locJump?.key ?? null}
            jumpToken={p.locJump?.token ?? 0}
            autofill={p.locJump?.autofill ?? false}
            autofillKeyOnly={p.locJump?.keyOnly ?? false}
            active={idx === activePane}
            onSaved={(text) => {
              patchPane(idx, { content: text, saved: '' })
            }}
            onUnsavedChange={(dirty) => {
              dirtyRefs.current[idx] = dirty
            }}
          />
        ) : cls.editable && isEventFile(f.rel) && p.editorMode === 'events' ? (
          <EventsEditor
            path={f.path}
            content={p.content}
            gameDir={gameDir}
            modPath={modInfo.path}
            locFiles={locFiles}
            focusIds={locFocusIds}
            eventRefs={eventRefs}
            active={idx === activePane}
            onOpenFocus={(focusId, focusRel) => {
              const ff = modInfo.files.find((x) => x.rel === focusRel)
              if (ff) openOrJump(ff, { focusJumpId: focusId }, idx)
            }}
            jumpId={p.eventJump?.id ?? null}
            jumpToken={p.eventJump?.token ?? 0}
            jumpAutofill={p.eventJump?.autofill ?? false}
            onOpenLoc={(key, locPath, autofill, keyOnly) => {
              const lf = modInfo.files.find((x) => x.path === locPath)
              if (lf) openOrJump(lf, { jumpKey: key, autofill, autofillKeyOnly: keyOnly }, idx)
            }}
            onSaved={(text) => {
              patchPane(idx, { content: text, saved: '' })
              void refreshEventLink()
            }}
            onUnsavedChange={(dirty) => {
              dirtyRefs.current[idx] = dirty
            }}
          />
        ) : cls.editable && isDecisionFile(f.rel) && p.editorMode === 'decisions' ? (
          <DecisionsEditor
            path={f.path}
            content={p.content}
            gameDir={gameDir}
            modPath={modInfo.path}
            locFiles={locFiles}
            focusIds={locFocusIds}
            active={idx === activePane}
            onOpenLoc={(key, locPath, autofill, keyOnly) => {
              const lf = modInfo.files.find((x) => x.path === locPath)
              if (lf) openOrJump(lf, { jumpKey: key, autofill, autofillKeyOnly: keyOnly }, idx)
            }}
            onSaved={(text) => {
              patchPane(idx, { content: text, saved: '' })
            }}
            onUnsavedChange={(dirty) => {
              dirtyRefs.current[idx] = dirty
            }}
          />
        ) : cls.editable && isIdeaFile(f.rel) && p.editorMode === 'ideas' ? (
          <IdeasEditor
            path={f.path}
            content={p.content}
            gameDir={gameDir}
            modPath={modInfo.path}
            locFiles={locFiles}
            focusIds={locFocusIds}
            active={idx === activePane}
            onOpenLoc={(key, locPath, autofill, keyOnly) => {
              const lf = modInfo.files.find((x) => x.path === locPath)
              if (lf) openOrJump(lf, { jumpKey: key, autofill, autofillKeyOnly: keyOnly }, idx)
            }}
            onSaved={(text) => {
              patchPane(idx, { content: text, saved: '' })
            }}
            onUnsavedChange={(dirty) => {
              dirtyRefs.current[idx] = dirty
            }}
          />
        ) : cls.editable && isCharacterFile(f.rel) && p.editorMode === 'characters' ? (
          <CharactersEditor
            path={f.path}
            content={p.content}
            gameDir={gameDir}
            modPath={modInfo.path}
            locFiles={locFiles}
            focusIds={locFocusIds}
            traitIds={traitIds}
            active={idx === activePane}
            onOpenLoc={(key, locPath, autofill, keyOnly) => {
              const lf = modInfo.files.find((x) => x.path === locPath)
              if (lf) openOrJump(lf, { jumpKey: key, autofill, autofillKeyOnly: keyOnly }, idx)
            }}
            onSaved={(text) => {
              patchPane(idx, { content: text, saved: '' })
            }}
            onUnsavedChange={(dirty) => {
              dirtyRefs.current[idx] = dirty
            }}
          />
        ) : cls.editable && isTraitFile(f.rel) && p.editorMode === 'traits' ? (
          <TraitsEditor
            path={f.path}
            content={p.content}
            gameDir={gameDir}
            modPath={modInfo.path}
            locFiles={locFiles}
            focusIds={locFocusIds}
            active={idx === activePane}
            onOpenLoc={(key, locPath, autofill, keyOnly) => {
              const lf = modInfo.files.find((x) => x.path === locPath)
              if (lf) openOrJump(lf, { jumpKey: key, autofill, autofillKeyOnly: keyOnly }, idx)
            }}
            onSaved={(text) => {
              patchPane(idx, { content: text, saved: '' })
            }}
            onUnsavedChange={(dirty) => {
              dirtyRefs.current[idx] = dirty
            }}
          />
        ) : cls.editable && isGfxFile(f.rel) && p.editorMode === 'gfx' ? (
          <GfxViewer content={p.content} gameDir={gameDir} modPath={modInfo.path} />
        ) : cls.editable ? (
          <textarea
            className="file-editor"
            value={p.content}
            spellCheck={false}
            onChange={(e) => {
              patchPane(idx, { content: e.target.value, saved: '' })
              dirtyRefs.current[idx] = true
            }}
          />
        ) : (
          <div className="viewer-empty">
            <p>该文件类型暂不支持在编辑器内查看。</p>
            <p className="viewer-empty-note">可以用系统文本编辑器直接打开此文件。</p>
          </div>
        )}
      </>
    )
  }

  return (
    <div className="mod-view">
      <div className="file-panel">
        <div className="file-panel-head">
          <input
            className="text-input tree-filter"
            placeholder={`搜索 ${modInfo.files.length} 个文件…`}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <button
            className="btn tiny"
            title="跨文件检查：缺失的本地化键、未定义/重复的 GFX 精灵、国策引用的事件是否存在"
            onClick={() => {
              setShowChecks((v) => !v)
              setShowNewEventForm(false)
              setShowNewDecForm(false)
              setShowNewIdeaForm(false)
              setShowNewCharForm(false)
              setShowNewTraitForm(false)
              setFileMsg('')
            }}
          >
            🔍 检查
          </button>
          <button
            className="btn tiny"
            title="在 common/decisions/ 下新建一个决议文件（自动生成分类和一个示例决议）"
            onClick={() => {
              setShowNewDecForm((v) => !v)
              setShowNewEventForm(false)
              setShowNewIdeaForm(false)
              setShowNewCharForm(false)
              setShowNewTraitForm(false)
              setFileMsg('')
              if (!showNewDecForm) setNewDecFileName(`${nsOfMod(modInfo)}_decisions.txt`)
            }}
          >
            ＋ 决议文件
          </button>
          <button
            className="btn tiny"
            title="在 common/ideas/ 下新建一个民族精神文件（自动生成 country 分类和一个示例精神）"
            onClick={() => {
              setShowNewIdeaForm((v) => !v)
              setShowNewEventForm(false)
              setShowNewDecForm(false)
              setShowNewCharForm(false)
              setShowNewTraitForm(false)
              setFileMsg('')
              if (!showNewIdeaForm) setNewIdeaFileName(`${nsOfMod(modInfo)}_ideas.txt`)
            }}
          >
            ＋ 精神文件
          </button>
          <button
            className="btn tiny"
            title="在 common/characters/ 下新建一个人物文件（自动生成一个带肖像与国家领袖职位的示例人物）"
            onClick={() => {
              setShowNewCharForm((v) => !v)
              setShowNewEventForm(false)
              setShowNewDecForm(false)
              setShowNewIdeaForm(false)
              setShowNewTraitForm(false)
              setFileMsg('')
              if (!showNewCharForm) setNewCharFileName(`${nsOfMod(modInfo)}_characters.txt`)
            }}
          >
            ＋ 人物文件
          </button>
          <button
            className="btn tiny"
            title="在 common/country_leader/ 下新建一个领导人特质文件（自动生成一个示例特质）"
            onClick={() => {
              setShowNewTraitForm((v) => !v)
              setShowNewEventForm(false)
              setShowNewDecForm(false)
              setShowNewIdeaForm(false)
              setShowNewCharForm(false)
              setFileMsg('')
              if (!showNewTraitForm) setNewTraitFileName(`${nsOfMod(modInfo)}_traits.txt`)
            }}
          >
            ＋ 特质文件
          </button>
          <button
            className="btn tiny"
            title="在 events/ 下新建一个事件文件（自动生成命名空间和一个示例事件）"
            onClick={() => {
              setShowNewEventForm((v) => !v)
              setShowNewDecForm(false)
              setShowNewIdeaForm(false)
              setShowNewCharForm(false)
              setShowNewTraitForm(false)
              setFileMsg('')
              if (!showNewEventForm) setNewEventFileName(`${nsOfMod(modInfo)}_events.txt`)
            }}
          >
            ＋ 事件文件
          </button>
          {showNewDecForm && (
            <div className="fp-create">
              <input
                className="text-input"
                value={newDecFileName}
                placeholder="文件名，如 my_decisions.txt"
                onChange={(e) => setNewDecFileName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void createNewDecisionFile()
                  else if (e.key === 'Escape') setShowNewDecForm(false)
                }}
              />
              <button className="btn small primary" disabled={creatingDecFile || !newDecFileName.trim()} onClick={() => void createNewDecisionFile()}>
                {creatingDecFile ? '创建中…' : '创建并打开'}
              </button>
            </div>
          )}
          {showNewIdeaForm && (
            <div className="fp-create">
              <input
                className="text-input"
                value={newIdeaFileName}
                placeholder="文件名，如 my_ideas.txt"
                onChange={(e) => setNewIdeaFileName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void createNewIdeasFile()
                  else if (e.key === 'Escape') setShowNewIdeaForm(false)
                }}
              />
              <button className="btn small primary" disabled={creatingIdeaFile || !newIdeaFileName.trim()} onClick={() => void createNewIdeasFile()}>
                {creatingIdeaFile ? '创建中…' : '创建并打开'}
              </button>
            </div>
          )}
          {showNewCharForm && (
            <div className="fp-create">
              <input
                className="text-input"
                value={newCharFileName}
                placeholder="文件名，如 my_characters.txt"
                onChange={(e) => setNewCharFileName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void createNewCharactersFile()
                  else if (e.key === 'Escape') setShowNewCharForm(false)
                }}
              />
              <button className="btn small primary" disabled={creatingCharFile || !newCharFileName.trim()} onClick={() => void createNewCharactersFile()}>
                {creatingCharFile ? '创建中…' : '创建并打开'}
              </button>
            </div>
          )}
          {showNewTraitForm && (
            <div className="fp-create">
              <input
                className="text-input"
                value={newTraitFileName}
                placeholder="文件名，如 my_traits.txt"
                onChange={(e) => setNewTraitFileName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void createNewTraitsFile()
                  else if (e.key === 'Escape') setShowNewTraitForm(false)
                }}
              />
              <button className="btn small primary" disabled={creatingTraitFile || !newTraitFileName.trim()} onClick={() => void createNewTraitsFile()}>
                {creatingTraitFile ? '创建中…' : '创建并打开'}
              </button>
            </div>
          )}
          {showNewEventForm && (
            <div className="fp-create">
              <input
                className="text-input"
                value={newEventFileName}
                placeholder="文件名，如 my_events.txt"
                onChange={(e) => setNewEventFileName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void createNewEventFile()
                  else if (e.key === 'Escape') setShowNewEventForm(false)
                }}
              />
              <button className="btn small primary" disabled={creatingFile || !newEventFileName.trim()} onClick={() => void createNewEventFile()}>
                {creatingFile ? '创建中…' : '创建并打开'}
              </button>
            </div>
          )}
          {fileMsg && <div className="fp-msg">{fileMsg}</div>}
        </div>
        <div className="file-tree">
          <Branch
            node={tree}
            depth={0}
            expanded={expanded}
            onToggle={toggle}
            filter={deferredFilter}
            active={panes[activePane].file?.path ?? null}
            secondary={panes[activePane === 0 ? 1 : 0].file?.path ?? null}
            onOpen={(f) => {
              // 已在另一栏打开 → 只切换激活，不重开（防同文件双开互踩写盘）
              const other: 0 | 1 = activePaneRef.current === 0 ? 1 : 0
              if (panesRef.current[other].file?.path === f.path) {
                activate(other)
                return
              }
              void openFile(activePaneRef.current, f)
            }}
            budget={{ left: MAX_VISIBLE_FILES }}
          />
        </div>
      </div>

      <div className="viewer-split" ref={splitWrapRef}>
        <div
          className={`viewer pane${activePane === 0 ? ' pane-active' : ''}`}
          style={{ flex: `0 0 ${split * 100}%` }}
          onMouseDown={() => activate(0)}
        >
          {renderPane(0)}
        </div>
        <div
          className={`pane-divider${splitDragging ? ' dragging' : ''}`}
          role="separator"
          aria-orientation="vertical"
          aria-label="调整左右栏宽度"
          title="拖动调整左右栏宽度，双击恢复对半"
          tabIndex={0}
          onPointerDown={onDividerPointerDown}
          onDoubleClick={() => commitSplit(PANE_SPLIT_DEFAULT)}
          onKeyDown={onDividerKeyDown}
        />
        <div
          className={`viewer pane${activePane === 1 ? ' pane-active' : ''}`}
          onMouseDown={() => activate(1)}
        >
          {renderPane(1)}
        </div>
      </div>

      {showChecks && (
        <CheckPanel
          mod={modInfo}
          gameDir={gameDir}
          onOpenIssue={openIssue}
          onClose={() => setShowChecks(false)}
        />
      )}
    </div>
  )
}
