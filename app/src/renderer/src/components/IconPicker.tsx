import { useMemo, useState } from 'react'
import type { IconSprite } from '../../../shared/types'

const LIMIT = 300

interface Props {
  sprites: IconSprite[]
  getUrl: (s: IconSprite) => string | null
  current: string
  onPick: (name: string) => void
  onClose: () => void
}

export default function IconPicker(props: Props): React.JSX.Element {
  const { sprites, getUrl, current, onPick, onClose } = props
  const [q, setQ] = useState('')

  const list = useMemo(() => {
    const f = q.trim().toLowerCase()
    const filtered = f
      ? sprites.filter((s) => s.name.toLowerCase().includes(f) || s.tex.toLowerCase().includes(f))
      : sprites
    return filtered.slice(0, LIMIT)
  }, [sprites, q])

  const isCurrent = (name: string): boolean => name === current || name === `GFX_${current}`

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="icon-picker" onClick={(e) => e.stopPropagation()}>
        <div className="icon-picker-head">
          <input
            className="text-input"
            autoFocus
            placeholder={`搜索 ${sprites.length} 个图标…`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button className="btn small" onClick={onClose}>
            关闭
          </button>
        </div>
        <div className="icon-grid">
          {list.map((s) => {
            const url = getUrl(s)
            return (
              <button
                key={s.name}
                className={isCurrent(s.name) ? 'icon-cell active' : 'icon-cell'}
                title={`${s.name}\n${s.tex}`}
                onClick={() => onPick(s.name)}
              >
                {url ? <img src={url} alt="" draggable={false} /> : <span className="icon-cell-ph">…</span>}
                <span className="icon-cell-name">{s.name.replace(/^GFX_/, '')}</span>
              </button>
            )
          })}
          {list.length === 0 && <div className="icon-grid-empty">没有匹配的图标</div>}
          {list.length === LIMIT && <div className="icon-grid-more">只显示前 {LIMIT} 个，请用搜索缩小范围</div>}
        </div>
      </div>
    </div>
  )
}
