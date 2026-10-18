import { useCallback, useEffect, useRef, useState } from 'react'
import { decodeDds, decodeTga } from '../../../shared/dds'
import type { IconSprite } from '../../../shared/types'

/**
 * 图标目录 hook：读取游戏 + 模组的 .gfx 精灵定义，并提供 DDS/TGA 解码后的缩略图 URL。
 * （国策编辑器与事件编辑器共用）
 */
export function useSpriteCatalog(gameDir: string | null, modPath: string): {
  sprites: IconSprite[]
  spriteFor: (name: string) => IconSprite | undefined
  getIconUrl: (sprite: IconSprite) => string | null
} {
  const [sprites, setSprites] = useState<IconSprite[]>([])
  const [, setTick] = useState(0)
  const urlCache = useRef(new Map<string, string | null>())

  useEffect(() => {
    void (async () => {
      try {
        setSprites(await window.api.listGoalSprites(gameDir, [modPath]))
      } catch {
        setSprites([])
      }
    })()
  }, [gameDir, modPath])

  const spriteFor = useCallback(
    (name: string): IconSprite | undefined => {
      if (!name) return undefined
      return sprites.find((s) => s.name === name) ?? sprites.find((s) => s.name === `GFX_${name}`)
    },
    [sprites]
  )

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

  return { sprites, spriteFor, getIconUrl }
}
