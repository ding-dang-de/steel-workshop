import { useState } from 'react'
import type { Settings, Hoi4Info } from '../../../shared/types'

interface Props {
  settings: Settings | null
  hoi4: Hoi4Info | null
  onOpen: (path: string) => void
  onCreate: (name: string) => void
  onPickGameDir: () => void
  onPickModsDir: () => void
}

export default function ProjectView(props: Props): React.JSX.Element {
  const { settings, hoi4, onOpen, onCreate, onPickGameDir, onPickModsDir } = props
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  const openByDialog = async (): Promise<void> => {
    const p = await window.api.selectFolder(settings?.modsDir ?? undefined)
    if (p) onOpen(p)
  }

  const doCreate = async (): Promise<void> => {
    if (!newName.trim() || creating) return
    setCreating(true)
    await onCreate(newName.trim())
    setCreating(false)
    setNewName('')
  }

  return (
    <div className="project-view">
      <div className="welcome">
        <h1>欢迎使用钢铁工坊</h1>
        <p className="desc">
          直接读写你电脑里的模组文件夹：保存即生效，进游戏就能玩。编辑只重写改过的条目，注释与排版原样保留。
        </p>

        <div className="cards">
          <div className="card create-card">
            <span className="card-title">新建模组</span>
            <span className="card-desc">输入名称，自动建好标准文件夹结构（国策/事件/本地化/决议……）</span>
            <div className="create-row">
              <input
                className="text-input"
                placeholder="模组名称"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void doCreate()
                }}
              />
              <button className="btn primary" disabled={!newName.trim() || creating} onClick={() => void doCreate()}>
                {creating ? '创建中…' : '创建'}
              </button>
            </div>
          </div>

          <div className="card">
            <span className="card-title">打开模组</span>
            <span className="card-desc">选择已有模组文件夹，无损读取——注释、空行、排版全部保留</span>
            <div className="create-row">
              <button className="btn" onClick={() => void openByDialog()}>
                选择文件夹…
              </button>
            </div>
          </div>
        </div>

        {settings && settings.recentMods.length > 0 && (
          <div className="recent">
            <h3>最近打开</h3>
            <div className="recent-list">
              {settings.recentMods.map((p) => (
                <button key={p} className="recent-item" title={p} onClick={() => onOpen(p)}>
                  {p.split(/[\\/]/).pop()}
                  <span className="recent-path">{p}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="settings-panel">
        <h3>环境设置</h3>
        <div className="setting-row">
          <span className="setting-label">游戏目录</span>
          <span className="setting-value" title={settings?.gameDir ?? ''}>
            {settings?.gameDir ?? '未设置'}
            {hoi4?.version && <span className="badge-version">v{hoi4.version}</span>}
          </span>
          <button className="btn small" onClick={onPickGameDir}>
            选择…
          </button>
        </div>
        <div className="setting-row">
          <span className="setting-label">模组文件夹</span>
          <span className="setting-value" title={settings?.modsDir ?? ''}>
            {settings?.modsDir ?? '未设置'}
          </span>
          <button className="btn small" onClick={onPickModsDir}>
            选择…
          </button>
        </div>
        <p className="setting-note">
          游戏目录用于读取图标库和命令库（国策树编辑器的图标预览、条件/效果智能提示都依赖它）。
        </p>
      </div>
    </div>
  )
}
