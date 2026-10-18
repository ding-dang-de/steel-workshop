import { useEffect, useRef, useState } from 'react'
import { loadLoc } from '../../../shared/localisation'

export interface LocIndexEntry {
  text: string
  placeholder: boolean
  path: string
}

/**
 * 本地化索引 hook：读取模组内全部本地化文件，建「键 → 文本/占位/所在文件」索引。
 * null 表示正在读取（或失败后为空索引）。
 */
export function useLocIndex(locFiles: { path: string; rel: string }[]): {
  index: { byKey: Map<string, LocIndexEntry>; paths: string[] } | null
} {
  const [index, setIndex] = useState<{ byKey: Map<string, LocIndexEntry>; paths: string[] } | null>(null)

  useEffect(() => {
    let cancelled = false
    setIndex(null)
    void (async () => {
      const byKey = new Map<string, LocIndexEntry>()
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
      setIndex({ byKey, paths: locFiles.map((f) => f.path) })
    })()
    return () => {
      cancelled = true
    }
  }, [locFiles])

  return { index }
}
