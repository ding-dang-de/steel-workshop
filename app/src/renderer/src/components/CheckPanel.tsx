import { useEffect, useMemo, useState } from 'react'
import { runModChecks, CHECK_KIND_LABELS } from '../../../shared/checks'
import type { CheckIssue, CheckKind } from '../../../shared/checks'
import type { OpenModInfo } from '../../../shared/types'

interface Props {
  mod: OpenModInfo
  gameDir: string | null
  /** 点击问题条目跳转（kind 决定目标文件与定位方式） */
  onOpenIssue: (issue: CheckIssue) => void
  onClose: () => void
}

/** 参与检查的文件目录（其余文件不读，大模组也不怕） */
const CHECK_DIRS = [
  'common/national_focus/',
  'events/',
  'common/decisions/',
  'common/ideas/',
  'common/country_leader/',
  'common/characters/',
  'localisation/'
]
const relevant = (rel: string): boolean => {
  if (CHECK_DIRS.some((d) => rel.startsWith(d))) return true
  // 任意目录的 .gfx（通常在 interface/ 下）
  return rel.split('.').pop()?.toLowerCase() === 'gfx'
}

const KIND_ORDER: CheckKind[] = ['loc-missing', 'gfx-undefined', 'gfx-duplicate', 'event-missing']

/** 扫描结果缓存：面板关掉重开时免重扫（大模组文件多，读+解析要几秒） */
interface CachedScan {
  key: string
  at: number
  issues: CheckIssue[]
}
let lastScan: CachedScan | null = null
const SCAN_TTL_MS = 5000
/** 指纹 = 参与检查文件的 rel:size 哈希（保存后 size 变化即失效；另有 5 秒 TTL 兜底） */
function scanKey(mod: OpenModInfo): string {
  let h = 5381
  for (const f of mod.files) {
    if (!relevant(f.rel)) continue
    const s = `${f.rel}:${f.size};`
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  }
  return `${mod.path}:${h >>> 0}`
}

/** 模组跨文件检查面板：打开即扫描，按类别列出问题，点条目跳转到对应文件 */
export default function CheckPanel({ mod, gameDir, onOpenIssue, onClose }: Props): React.JSX.Element {
  const [issues, setIssues] = useState<CheckIssue[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const key = scanKey(mod)
    const hit = lastScan && lastScan.key === key && Date.now() - lastScan.at < SCAN_TTL_MS ? lastScan : null
    if (hit) {
      setIssues(hit.issues)
      return
    }
    let alive = true
    void (async () => {
      try {
        const files: { rel: string; source: string }[] = []
        for (const f of mod.files) {
          if (!relevant(f.rel)) continue
          try {
            files.push({ rel: f.rel, source: await window.api.readTextFile(f.path) })
          } catch {
            // 单个文件读取失败跳过
          }
        }
        let gameGfxNames: Set<string> | undefined
        try {
          gameGfxNames = new Set(await window.api.listGameGfxNames(gameDir))
        } catch {
          gameGfxNames = undefined
        }
        const result = runModChecks({ files, gameGfxNames })
        if (!alive) return
        lastScan = { key, at: Date.now(), issues: result }
        setIssues(result)
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      alive = false
    }
  }, [mod, gameDir])

  const groups = useMemo(() => {
    if (!issues) return []
    return KIND_ORDER.map((kind) => ({ kind, items: issues.filter((i) => i.kind === kind) })).filter((g) => g.items.length > 0)
  }, [issues])

  return (
    <div className="ck-overlay" onClick={onClose}>
      <div className="ck-panel" onClick={(e) => e.stopPropagation()}>
        <div className="ck-head">
          <span className="ck-title">模组检查</span>
          <button className="btn small" onClick={onClose}>
            关闭
          </button>
        </div>
        <div className="ck-body">
          {error ? (
            <div className="load-error">检查失败：{error}</div>
          ) : issues === null ? (
            <div className="ck-loading">正在扫描模组文件…</div>
          ) : issues.length === 0 ? (
            <div className="ck-ok">✓ 未发现问题（共扫描 {mod.files.length} 个文件里的相关内容）</div>
          ) : (
            <>
              <div className="ck-summary">
                共 {issues.length} 个问题：
                {groups.map((g) => (
                  <span key={g.kind} className={`ck-kind ck-kind-${g.kind}`}>
                    {CHECK_KIND_LABELS[g.kind]} {g.items.length}
                  </span>
                ))}
              </div>
              {groups.map((g) => (
                <div key={g.kind} className="ck-group">
                  <div className={`ck-group-title ck-kind-${g.kind}`}>
                    {CHECK_KIND_LABELS[g.kind]}（{g.items.length}）
                  </div>
                  {g.items.map((it, i) => (
                    <button key={i} className="ck-row" onClick={() => onOpenIssue(it)} title={`${it.file} —— ${it.message}`}>
                      <span className="ck-subject">{it.subject}</span>
                      <span className="ck-file">{it.file}</span>
                      <span className="ck-msg">{it.message}</span>
                    </button>
                  ))}
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
