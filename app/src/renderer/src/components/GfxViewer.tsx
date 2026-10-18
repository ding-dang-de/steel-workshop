import { useEffect, useMemo, useRef, useState } from 'react'
import { loadGfx } from '../../../shared/gfx'
import { decodeDds, decodeTga } from '../../../shared/dds'

interface Props {
  content: string
  gameDir: string | null
  modPath: string
}

/** 贴图解码结果按候选路径缓存（跨卡片复用，避免重复解码） */
const urlCache = new Map<string, string | null>()
/** 进行中的解码（React StrictMode 会双跑 effect，靠它让两次调用共享同一个结果） */
const inflight = new Map<string, Promise<string | null>>()

/** 依次尝试候选路径，读 + 解码成 data URL；文件不存在或解码失败返回 null */
async function decodeToUrl(candidates: string[]): Promise<string | null> {
  const key = candidates.join('|')
  const hit = urlCache.get(key)
  if (hit !== undefined) return hit
  const running = inflight.get(key)
  if (running) return running
  const p = (async (): Promise<string | null> => {
    for (const cand of candidates) {
      try {
        const bytes = new Uint8Array(await window.api.readBytes(cand))
        const ext = cand.split('.').pop()?.toLowerCase()
        const img = ext === 'tga' ? decodeTga(bytes) : decodeDds(bytes)
        if (img) {
          const canvas = document.createElement('canvas')
          canvas.width = img.width
          canvas.height = img.height
          const ctx = canvas.getContext('2d')
          if (ctx) {
            ctx.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0)
            return canvas.toDataURL()
          }
        }
      } catch {
        // 文件不存在或读取失败 → 换下一个候选
      }
    }
    return null
  })()
  inflight.set(key, p)
  try {
    const url = await p
    urlCache.set(key, url)
    return url
  } finally {
    inflight.delete(key)
  }
}

/** 懒解码缩略图：进入视口（外扩 200px）才开始读文件解码 */
function Thumb({ candidates }: { candidates: string[] }): React.JSX.Element {
  const [url, setUrl] = useState<string | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'ok' | 'miss'>('idle')
  const ref = useRef<HTMLDivElement | null>(null)
  const key = candidates.join('|')

  useEffect(() => {
    let alive = true
    const load = async (): Promise<void> => {
      if (urlCache.has(key)) {
        setUrl(urlCache.get(key) ?? null)
        setState(urlCache.get(key) ? 'ok' : 'miss')
        return
      }
      setState('loading')
      const u = await decodeToUrl(candidates)
      if (!alive) return
      setUrl(u)
      setState(u ? 'ok' : 'miss')
    }
    const el = ref.current
    // 文档不可见（如窗口最小化）时 IO 不触发，直接解码兜底
    if (!el || !('IntersectionObserver' in window) || document.visibilityState === 'hidden') {
      void load()
      return () => {
        alive = false
      }
    }
    const io = new IntersectionObserver(
      (ents) => {
        if (ents.some((e) => e.isIntersecting)) {
          io.disconnect()
          void load()
        }
      },
      { rootMargin: '200px' }
    )
    io.observe(el)
    return () => {
      alive = false
      io.disconnect()
    }
    // candidates 每次渲染都是新数组，用拼接键作依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return (
    <div className="gx-thumb" ref={ref}>
      {state === 'ok' && url ? (
        <img src={url} alt="" draggable={false} />
      ) : state === 'loading' ? (
        <span className="gx-thumb-note">解码中…</span>
      ) : state === 'miss' ? (
        <span className="gx-thumb-note gx-thumb-miss" title="模组与游戏目录里都找不到这个贴图，或无法解码">
          ⚠ 贴图缺失
        </span>
      ) : (
        <span className="gx-thumb-note">…</span>
      )}
    </div>
  )
}

/** .gfx 精灵查看器（只读）：搜索 + 缩略图卡片网格 + 重复名 / 缺失贴图警告 */
export default function GfxViewer({ content, gameDir, modPath }: Props): React.JSX.Element {
  const [filter, setFilter] = useState('')
  const model = useMemo(() => loadGfx(content), [content])

  const base = modPath.replace(/[\\/]+$/, '')
  const gbase = gameDir ? gameDir.replace(/[\\/]+$/, '') : null
  /** 贴图解析顺序：模组目录优先，游戏目录兜底（游戏原生精灵也能看） */
  const candidatesOf = (tex: string): string[] => {
    const list = [`${base}/${tex}`]
    if (gbase) list.push(`${gbase}/${tex}`)
    return list
  }

  if (!model) {
    return <div className="load-error">无法解析此 .gfx 文件</div>
  }

  const f = filter.trim().toLowerCase()
  const sprites = f
    ? model.sprites.filter((s) => s.name.toLowerCase().includes(f) || s.tex.toLowerCase().includes(f))
    : model.sprites

  return (
    <div className="gx-viewer">
      {model.errors.length > 0 && (
        <div className="parse-errors">
          {model.errors.slice(0, 5).map((e, i) => (
            <div key={i} className="parse-error-line">
              第 {e.line} 行第 {e.col} 列：{e.message}
            </div>
          ))}
          {model.errors.length > 5 && <div className="parse-error-line">…共 {model.errors.length} 处</div>}
        </div>
      )}

      <div className="gx-head">
        <input
          className="gx-search"
          type="text"
          placeholder={`搜索精灵（共 ${model.sprites.length} 个）`}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <span className="gx-count">
          显示 {sprites.length} / {model.sprites.length}
        </span>
      </div>

      {model.duplicates.size > 0 && (
        <div className="gx-dup-summary">
          ⚠ 重复定义的精灵名（游戏只会采用最后一个定义）：
          {[...model.duplicates.entries()].map(([name, count], i) => (
            <span key={name} className="gx-dup-chip">
              {i > 0 ? '、' : ' '}
              {name}（{count} 次）
            </span>
          ))}
        </div>
      )}

      {model.sprites.length === 0 ? (
        <div className="viewer-empty">
          <p>此文件没有 spriteTypes 精灵定义。</p>
        </div>
      ) : sprites.length === 0 ? (
        <div className="viewer-empty">
          <p>没有匹配「{filter}」的精灵。</p>
        </div>
      ) : (
        <div className="gx-grid">
          {sprites.map((s, i) => (
            <div key={`${s.name}-${i}`} className="gx-card">
              <Thumb candidates={candidatesOf(s.tex)} />
              <div className="gx-info">
                <div className="gx-name" title={s.name}>
                  {s.name}
                </div>
                <div className="gx-tex" title={s.tex}>
                  {s.tex}
                </div>
                {s.extra.length > 0 && (
                  <div className="gx-extra">
                    {s.extra.map(([k, v]) => (
                      <span key={k} className="gx-extra-kv">
                        {k} = {v}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="gx-badges">
                {model.duplicates.has(s.name) && (
                  <span className="gx-badge gx-badge-dup" title="同一精灵名定义了多次，游戏只会采用最后一个">
                    ⚠ 重复
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
