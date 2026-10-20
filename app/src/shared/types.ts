/** 主进程/预加载/渲染进程共享的数据类型 */

export interface Settings {
  /** HOI4 游戏安装目录 */
  gameDir: string | null
  /** 模组文件夹（通常为 文档/Paradox Interactive/Hearts of Iron IV/mod） */
  modsDir: string | null
  /** 最近打开的模组目录列表（最新的在前） */
  recentMods: string[]
  /** 双栏分屏左栏占宽度比例（0.2–0.8，默认 0.5） */
  paneSplit: number
}

export interface Hoi4Info {
  gameDir: string | null
  modsDir: string | null
  version: string | null
}

export interface ScanFile {
  /** 绝对路径 */
  path: string
  /** 相对模组根目录的路径（用 / 分隔） */
  rel: string
  size: number
}

export interface ModDescriptor {
  name: string | null
  supportedVersion: string | null
  path: string | null
  tags: string[]
}

export interface OpenModInfo {
  /** 模组显示名（优先 descriptor 中的 name） */
  name: string
  /** 模组文件夹绝对路径 */
  path: string
  files: ScanFile[]
  descriptor: ModDescriptor | null
}

export interface CreateModResult {
  modPath: string
  modFilePath: string
  supportedVersion: string
}

/** .gfx 精灵（图标）定义 */
export interface IconSprite {
  /** 精灵名，如 GFX_goal_generic_support_the_left */
  name: string
  /** 贴图相对路径，如 gfx/interface/goals/xxx.dds */
  tex: string
  /** 贴图绝对路径；文件不存在时为 null */
  path: string | null
  /** 定义来源（.gfx 文件路径） */
  source: string
}
