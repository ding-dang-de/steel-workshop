import { useEffect, useRef, useState } from 'react'
import type { Settings, Hoi4Info, OpenModInfo } from '../../shared/types'
import ProjectView from './components/ProjectView'
import ModView, { type ModViewHandle } from './components/ModView'

export default function App(): React.JSX.Element {
  const [settings, setSettingsState] = useState<Settings | null>(null)
  const [hoi4, setHoi4] = useState<Hoi4Info | null>(null)
  const [mod, setMod] = useState<OpenModInfo | null>(null)
  const [hint, setHint] = useState('')
  /** 返回项目管理前经 ModView 确认未保存修改 */
  const modViewRef = useRef<ModViewHandle>(null)

  useEffect(() => {
    void (async () => {
      try {
        const [s, h] = await Promise.all([window.api.getSettings(), window.api.detectHoi4()])
        setHoi4(h)
        // 自动补全设置（首次运行时检测到的路径写回设置）
        if (!s.gameDir && h.gameDir) s.gameDir = h.gameDir
        if (!s.modsDir && h.modsDir) s.modsDir = h.modsDir
        setSettingsState(await window.api.setSettings(s))
      } catch (err) {
        setHint(String(err instanceof Error ? err.message : err))
      }
    })()
  }, [])

  const openModPath = async (path: string): Promise<void> => {
    try {
      const info = await window.api.openMod(path)
      setMod(info)
      setHint('')
      setSettingsState(await window.api.getSettings())
    } catch (err) {
      setHint(`打开模组失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const createModFlow = async (name: string): Promise<void> => {
    const dir = settings?.modsDir
    if (!dir) {
      setHint('未找到模组文件夹，请先在下方设置')
      return
    }
    try {
      const result = await window.api.createMod(name, dir)
      await openModPath(result.modPath)
    } catch (err) {
      setHint(`创建模组失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const pickGameDir = async (): Promise<void> => {
    const p = await window.api.selectFolder(settings?.gameDir ?? undefined)
    if (p) setSettingsState(await window.api.setSettings({ gameDir: p }))
  }

  const pickModsDir = async (): Promise<void> => {
    const p = await window.api.selectFolder(settings?.modsDir ?? undefined)
    if (p) setSettingsState(await window.api.setSettings({ modsDir: p }))
  }

  return (
    <div className="app">
      <header className="titlebar">
        <span className="logo">⚒ 钢铁工坊</span>
        <span className="subtitle">钢铁雄心4 模组编辑器</span>
        {mod && (
          <button
            className="back-btn"
            onClick={() => {
              // 有未保存修改时先确认（取消则留在原地）；窗口整体关闭（点 X）不拦截
              if (!(modViewRef.current?.confirmClose() ?? true)) return
              setMod(null)
            }}
          >
            ← 返回项目管理
          </button>
        )}
      </header>

      <div className="body">
        {mod ? (
          <ModView ref={modViewRef} mod={mod} gameDir={settings?.gameDir ?? null} />
        ) : (
          <ProjectView
            settings={settings}
            hoi4={hoi4}
            onOpen={openModPath}
            onCreate={createModFlow}
            onPickGameDir={pickGameDir}
            onPickModsDir={pickModsDir}
          />
        )}
      </div>

      <footer className="statusbar">
        <span>钢铁工坊 v0.1.0</span>
        {hoi4?.version && <span>游戏版本 {hoi4.version}</span>}
        {mod && <span>当前模组：{mod.name}</span>}
        {hint && <span className="hint">{hint}</span>}
      </footer>
    </div>
  )
}
