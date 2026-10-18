import { app } from 'electron'
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  statSync,
  copyFileSync,
  unlinkSync
} from 'fs'
import { join, dirname, relative, basename, extname } from 'path'
import { createHash } from 'crypto'
import { parseFile, findEntry, scalarText, findAllEntries } from '../shared/clausewitz'
import type { CreateModResult, ModDescriptor, ScanFile, OpenModInfo } from '../shared/types'

/** 非法文件名字符清理 */
export function sanitizeName(name: string): string {
  const cleaned = name.trim().replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, ' ')
  return cleaned.slice(0, 80)
}

/** 创建新模组：在 modsDir 下建文件夹 + .mod 文件 + 标准目录骨架 */
export function createMod(name: string, modsDir: string, supportedVersion: string): CreateModResult {
  const safeName = sanitizeName(name)
  if (!safeName) throw new Error('模组名称不能为空')
  const modPath = join(modsDir, safeName)
  const modFilePath = join(modsDir, `${safeName}.mod`)
  if (existsSync(modPath) || existsSync(modFilePath)) {
    throw new Error(`同名模组已存在：${safeName}`)
  }

  const dirs = [
    'common/national_focus',
    'common/ideas',
    'common/decisions/categories',
    'common/characters',
    'common/countries',
    'events',
    'history/countries',
    'localisation/english',
    'localisation/simp_chinese',
    'interface',
    'gfx'
  ]
  for (const d of dirs) mkdirSync(join(modPath, d), { recursive: true })

  const version = supportedVersion.split('.').slice(0, 2).join('.') + '.*'
  const descriptor = [
    'version="1"',
    'tags={',
    '\t"Gameplay"',
    '\t"Balance"',
    '}',
    `name="${safeName}"`,
    `supported_version="${version}"`,
    `path="mod/${safeName}"`,
    ''
  ].join('\r\n')

  writeFileSync(modFilePath, descriptor, 'utf8')
  writeFileSync(join(modPath, 'descriptor.mod'), descriptor, 'utf8')

  // 一个最小的本地化文件骨架（带 BOM），证明整套链路可用
  const locKey = `${safeName.replace(/[^A-Za-z0-9_]/g, '_')}_TITLE`
  const loc = ['\ufeffl_english:', ` ${locKey}:0 "${safeName}"`, ''].join('\r\n')
  writeFileSync(join(modPath, 'localisation', 'english', `${safeName}_l_english.yml`), loc, 'utf8')

  return { modPath, modFilePath, supportedVersion: version }
}

/** 读取模组描述文件（优先文件夹内 descriptor.mod，其次旁边同名 .mod） */
export function readModDescriptor(modPath: string): ModDescriptor | null {
  const candidates = [
    join(modPath, 'descriptor.mod'),
    join(dirname(modPath), `${basename(modPath)}.mod`)
  ]
  for (const p of candidates) {
    try {
      if (!existsSync(p)) continue
      const { file } = parseFile(readFileSync(p, 'utf8'), 'txt')
      if (!file) continue
      const name = findEntry(file.items, 'name')
      const ver = findEntry(file.items, 'supported_version')
      const pathE = findEntry(file.items, 'path')
      const tags = findAllEntries(file.items, 'tags')
      const tagList: string[] = []
      for (const t of tags) {
        if (t.value?.kind === 'block') {
          for (const c of t.value.items) {
            const s = scalarText(c)
            if (s) tagList.push(s)
          }
        } else {
          const s = scalarText(t)
          if (s) tagList.push(s)
        }
      }
      return {
        name: name ? scalarText(name) : null,
        supportedVersion: ver ? scalarText(ver) : null,
        path: pathE ? scalarText(pathE) : null,
        tags: tagList
      }
    } catch {
      // 继续尝试下一个候选
    }
  }
  return null
}

/** 扫描模组内的文本类文件（供文件树展示） */
const TEXT_EXTS = new Set(['.txt', '.yml', '.gfx', '.mod', '.json', '.csv'])
const SKIP_DIRS = new Set(['.paradoxart', '.git', '.steel-workshop', '.vscode'])
const MAX_FILES = 5000

export function scanMod(modPath: string): ScanFile[] {
  const files: ScanFile[] = []
  const walk = (dir: string, depth: number): void => {
    if (files.length >= MAX_FILES || depth > 8) return
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const name of entries) {
      const full = join(dir, name)
      let isDir = false
      try {
        isDir = statSync(full).isDirectory()
      } catch {
        continue
      }
      if (isDir) {
        if (SKIP_DIRS.has(name)) continue
        walk(full, depth + 1)
      } else if (TEXT_EXTS.has(extname(name).toLowerCase())) {
        const rel = relative(modPath, full).split('\\').join('/')
        files.push({ path: full, rel, size: statSync(full).size })
      }
    }
  }
  walk(modPath, 0)
  files.sort((a, b) => a.rel.localeCompare(b.rel))
  return files
}

export function openModInfo(modPath: string): OpenModInfo {
  const descriptor = readModDescriptor(modPath)
  return {
    name: descriptor?.name ?? basename(modPath),
    path: modPath,
    files: scanMod(modPath),
    descriptor
  }
}

// ---------- 自动备份 + 写入 ----------

function backupsDir(): string {
  return join(app.getPath('userData'), 'backups')
}

/** 备份一个文件到 userData/backups/<目录哈希>/<文件名>.<时间戳>.bak，保留最近 10 份 */
export function backupFile(filePath: string): string | null {
  try {
    if (!existsSync(filePath)) return null
    const hash = createHash('md5').update(dirname(filePath)).digest('hex').slice(0, 12)
    const dir = join(backupsDir(), hash)
    mkdirSync(dir, { recursive: true })
    const stamp = new Date()
      .toISOString()
      .replace(/[-:]/g, '')
      .replace('T', '-')
      .slice(0, 15)
    const bakPath = join(dir, `${basename(filePath)}.${stamp}.bak`)
    copyFileSync(filePath, bakPath)

    // 清理：每个文件只保留最近 10 份备份
    const prefix = `${basename(filePath)}.`
    const existing = readdirSync(dir)
      .filter((f) => f.startsWith(prefix) && f.endsWith('.bak'))
      .sort()
    if (existing.length > 10) {
      for (const old of existing.slice(0, existing.length - 10)) {
        try {
          unlinkSync(join(dir, old))
        } catch {
          // 忽略清理失败
        }
      }
    }
    return bakPath
  } catch (err) {
    console.error('备份失败:', err)
    return null
  }
}

export function writeTextFile(filePath: string, content: string): { backedUp: string | null } {
  mkdirSync(dirname(filePath), { recursive: true })
  const backedUp = backupFile(filePath)
  writeFileSync(filePath, content, 'utf8')
  return { backedUp }
}

export function listDir(dirPath: string): { name: string; path: string; isDir: boolean }[] {
  let names: string[]
  try {
    names = readdirSync(dirPath)
  } catch {
    return []
  }
  return names
    .map((name) => {
      const full = join(dirPath, name)
      let isDir = false
      try {
        isDir = statSync(full).isDirectory()
      } catch {
        return null
      }
      return { name, path: full, isDir }
    })
    .filter((x): x is { name: string; path: string; isDir: boolean } => x !== null)
    .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
}
