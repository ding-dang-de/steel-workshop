import { useEffect, useMemo, useState } from 'react'
import { suggestModifierKeys } from '../../../shared/modifiers'
import { hasCjk } from '../../../shared/cjk'

/**
 * 修饰符键自动补全输入（民族精神 modifier 行与领导人特质行共用）：
 * 输入英文/中文过滤目录，下拉显示键名 + 中文说明 + 分类；Enter 选中、失焦可提交已输入文本。
 * 中文只作查询，不会被提交成键名。
 */
export default function ModKeyInput({
  value,
  onPick,
  placeholder,
  commitOnBlur
}: {
  value: string
  onPick: (key: string) => void
  placeholder?: string
  /** 失焦时把已输入的文本提交（用于已有行的改名） */
  commitOnBlur?: boolean
}): React.JSX.Element {
  const [text, setText] = useState(value)
  const [open, setOpen] = useState(false)
  const [sel, setSel] = useState(0)

  useEffect(() => {
    setText(value)
  }, [value])

  const matches = useMemo(() => suggestModifierKeys(text, 10), [text])
  // 中文/全角只作查询，不作键名：有 CJK 且无匹配时拦截提交并给出提示
  const cjk = hasCjk(text)
  const blocked = cjk && text.trim() !== '' && matches.length === 0

  useEffect(() => {
    setSel(0)
  }, [matches.length])

  const pick = (key: string): void => {
    setText(key)
    setOpen(false)
    onPick(key)
  }

  return (
    <div className="im-key-box">
      <input
        className="text-input im-key"
        value={text}
        placeholder={placeholder ?? '输入修饰符名…'}
        onChange={(e) => {
          setText(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setTimeout(() => setOpen(false), 150)
          if (commitOnBlur) {
            const t = text.trim()
            if (t && t !== value) {
              // 中文只作查询：失焦不提交 CJK 文本，回显模型值
              if (hasCjk(t)) setText(value)
              else onPick(t)
            }
          } else if (hasCjk(text) && text !== value) {
            setText(value)
          }
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
            if (matches[sel]) pick(matches[sel].key)
            else if (text.trim() && !cjk) pick(text.trim())
          } else if (e.key === 'Escape') {
            setOpen(false)
          }
        }}
      />
      {open && (matches.length > 0 || blocked) && (
        <div className="im-drop">
          {matches.map((s, i) => (
            <div
              key={s.key}
              className={i === sel ? 'im-drop-item sel' : 'im-drop-item'}
              onMouseDown={(e) => {
                e.preventDefault()
                pick(s.key)
              }}
              onMouseEnter={() => setSel(i)}
            >
              <span className="im-drop-key">{s.key}</span>
              <span className="im-drop-zh">{s.zh}</span>
              <span className="im-drop-cat">{s.cat}</span>
              {s.pct && <span className="im-drop-pct">%</span>}
            </div>
          ))}
          {blocked && (
            <div className="drop-note">没有匹配的修饰符；中文只用于搜索，不会被写成键名——请换关键词，或点右上角「📖 对照表」浏览</div>
          )}
        </div>
      )}
    </div>
  )
}
