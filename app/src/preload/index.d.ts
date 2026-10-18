import type { Settings, Hoi4Info, OpenModInfo, CreateModResult, ModDescriptor, IconSprite } from '../shared/types'

declare global {
  interface Window {
    api: {
      appName: string
      versions: Record<string, string>
      selectFolder: (defaultPath?: string) => Promise<string | null>
      readTextFile: (path: string) => Promise<string>
      writeTextFile: (path: string, content: string) => Promise<{ backedUp: string | null }>
      listDir: (path: string) => Promise<{ name: string; path: string; isDir: boolean }[]>
      readBytes: (path: string) => Promise<ArrayBuffer>
      listGoalSprites: (gameDir: string | null, modPaths: string[]) => Promise<IconSprite[]>
      listGameGfxNames: (gameDir: string | null) => Promise<string[]>
      openMod: (modPath: string) => Promise<OpenModInfo>
      createMod: (name: string, modsDir: string) => Promise<CreateModResult>
      readModDescriptor: (modPath: string) => Promise<ModDescriptor | null>
      getSettings: () => Promise<Settings>
      setSettings: (patch: Partial<Settings>) => Promise<Settings>
      detectHoi4: () => Promise<Hoi4Info>
    }
  }
}

export {}
