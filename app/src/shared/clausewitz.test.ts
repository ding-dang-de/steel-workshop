import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  parseFile,
  serialize,
  findEntry,
  findAllEntries,
  setString,
  makeScalarEntry,
  makeBlockEntry,
  makeBareItem,
  countEntries,
  type CwItem,
  type CwBlock
} from './clausewitz.ts'

const fixturesDir = join(import.meta.dirname, 'fixtures')

function parseOk(src: string, kind: 'txt' | 'yml'): NonNullable<ReturnType<typeof parseFile>['file']> {
  const { file, errors } = parseFile(src, kind)
  assert.equal(errors.length, 0, `解析错误: ${JSON.stringify(errors)}`)
  assert.ok(file)
  return file
}

/** 块值断言辅助 */
function asBlock(item: CwItem): CwBlock {
  assert.ok(item.value && item.value.kind === 'block', '期望块值')
  return item.value
}

// ---------- 1. 原版文件无损往返 ----------

test('finland 原版国策文件：解析零错误 + 序列化逐字节一致', () => {
  const src = readFileSync(join(fixturesDir, 'finland_vanilla.txt'), 'utf8')
  const file = parseOk(src, 'txt')
  assert.equal(serialize(file), src, '往返序列化必须逐字节一致')
  console.log(`  finland: ${countEntries(file.items)} 个条目, ${file.items.length} 个顶层条目, 换行="${file.newline}"`)
})

test('generic 原版国策文件：解析零错误 + 序列化逐字节一致', () => {
  const src = readFileSync(join(fixturesDir, 'generic_vanilla.txt'), 'utf8')
  const file = parseOk(src, 'txt')
  assert.equal(serialize(file), src)
})

// ---------- 2. 单条修改：只动被改的条目 ----------

test('修改一个国策的 cost：改动条目之外的字节完全不变', () => {
  const src = readFileSync(join(fixturesDir, 'finland_vanilla.txt'), 'utf8')
  const file = parseOk(src, 'txt')

  const tree = findEntry(file.items, 'focus_tree')
  assert.ok(tree)
  const focuses = findAllEntries(asBlock(tree).items, 'focus')
  assert.ok(focuses.length > 1, 'finland 应有多个国策')

  const target = focuses[0]
  const siblingRaw = file.source.slice(focuses[1].rawStart, focuses[1].rawEnd)

  // 修改第一个国策的 cost
  const cost = findEntry(asBlock(target).items, 'cost')
  assert.ok(cost, '国策应有 cost 字段')
  setString(cost, '999')

  const out = serialize(file)
  assert.notEqual(out, src, '输出应发生变化')
  assert.ok(out.includes('cost = 999'))

  // 被改条目前的字节逐字一致（clean 条目原样输出）
  assert.equal(out.slice(0, target.rawStart), src.slice(0, target.rawStart))
  // 被改条目之后的字节逐字一致
  const suffixLen = src.length - target.rawEnd
  assert.equal(out.slice(out.length - suffixLen), src.slice(src.length - suffixLen))
  // 兄弟国策原样保留
  assert.ok(out.includes(siblingRaw), '兄弟国策必须逐字保留')

  // 输出可再解析且稳定
  const again = parseOk(out, 'txt')
  assert.equal(serialize(again), out, '修改后的文件再次往返仍应一致')
  console.log(`  修改前 ${src.length} 字节 -> 修改后 ${out.length} 字节（差异集中在被改条目）`)
})

test('在国策树末尾插入新国策：既有内容逐字保留', () => {
  const src = readFileSync(join(fixturesDir, 'generic_vanilla.txt'), 'utf8')
  const file = parseOk(src, 'txt')

  const tree = findEntry(file.items, 'focus_tree')
  assert.ok(tree)
  const block = asBlock(tree)
  const firstFocusRaw = file.source.slice(block.items[0].rawStart, block.items[0].rawEnd)

  tree.dirty = true
  block.items.push(
    makeBlockEntry('focus', [
      makeScalarEntry('id', 'TST_new_focus'),
      makeScalarEntry('x', '1'),
      makeScalarEntry('y', '2'),
      makeScalarEntry('cost', '10')
    ])
  )

  const out = serialize(file)
  assert.ok(out.includes('TST_new_focus'))
  assert.ok(out.includes(firstFocusRaw), '既有国策必须逐字保留')

  const again = parseOk(out, 'txt')
  assert.equal(serialize(again), out)
})

// ---------- 3. yml 本地化文件 ----------

const ymlSrc = '﻿l_english:\r\n # 头部注释\r\n FIN_x:0 "Text §Rred§!" # 行尾注释\r\n FIN_y:1 "Two"\r\n'

test('yml：BOM + CRLF + 注释往返无损', () => {
  const file = parseOk(ymlSrc, 'yml')
  assert.equal(serialize(file), ymlSrc)
})

test('yml：修改一条文本，其余内容（含 BOM/注释/CRLF）不变', () => {
  const file = parseOk(ymlSrc, 'yml')
  const y = findEntry(file.items, 'FIN_y:1')
  assert.ok(y)
  setString(y, '修改后的文本')
  const out = serialize(file)
  assert.ok(out.startsWith('﻿l_english:\r\n # 头部注释\r\n FIN_x:0 "Text §Rred§!" # 行尾注释\r\n'))
  assert.ok(out.includes('FIN_y:1 "修改后的文本"'))
  assert.ok(out.endsWith('\r\n'))
  const again = parseOk(out, 'yml')
  assert.equal(serialize(again), out)
})

// ---------- 4. 边界情况 ----------

test('块内裸值列表（mutually_exclusive）修改后语义不变', () => {
  const src = 'focus_tree = {\n\tfocus = {\n\t\tid = A\n\t}\n\tmutually_exclusive = { A B }\n}\n'
  const file = parseOk(src, 'txt')
  const tree = findEntry(file.items, 'focus_tree')!
  const mx = findEntry(asBlock(tree).items, 'mutually_exclusive')
  assert.ok(mx)
  mx.dirty = true
  const out = serialize(file)
  // 规范化重渲染后与原文本一致（单行裸值列表按原版习惯输出）
  assert.equal(out, src)
  const again = parseOk(out, 'txt')
  const mx2 = findEntry(asBlock(findEntry(again.items, 'focus_tree')!).items, 'mutually_exclusive')
  const block = asBlock(mx2!)
  assert.equal(block.items.length, 2)
  assert.equal(block.items[0].kind, 'bare-item')
  assert.equal(block.items[0].value && block.items[0].value.kind === 'scalar' ? block.items[0].value.token.text : '', 'A')
  assert.equal(serialize(again), out)
})

test('文件末尾注释且无换行', () => {
  const src = 'x = 1 # eof'
  const file = parseOk(src, 'txt')
  assert.equal(serialize(file), src)
})

test('块未闭合时报错但可恢复', () => {
  const { file, errors } = parseFile('focus_tree = {\n\tfocus = {\n\t\tid = A\n\t}\n', 'txt')
  assert.ok(errors.length >= 1)
  assert.ok(file)
  const tree = findEntry(file.items, 'focus_tree')
  assert.ok(tree)
})

test('嵌套修改：只重写最内层被改条目', () => {
  const src = 'focus_tree = {\n\t# 树的注释\n\tfocus = {\n\t\tid = A\n\t\tcost = 10\n\t}\n\tfocus = {\n\t\tid = B\n\t\tprerequisite = { A }\n\t}\n}\n'
  const file = parseOk(src, 'txt')
  const tree = findEntry(file.items, 'focus_tree')!
  const focuses = findAllEntries(asBlock(tree).items, 'focus')
  const b = focuses[1]
  const pre = findEntry(asBlock(b).items, 'prerequisite')
  assert.ok(pre)
  pre.dirty = true
  asBlock(pre).items.push(makeBareItem('B'))
  const out = serialize(file)
  // 只动了 B 的 prerequisite：注释和 A 的原文必须逐字保留
  assert.ok(out.includes('\t# 树的注释\n\tfocus = {\n\t\tid = A\n\t\tcost = 10\n\t}'))
  // prerequisite 被重写为单行裸值列表（原版习惯）
  assert.ok(out.includes('prerequisite = { A B }'), `prerequisite 未按预期重写，输出: ${out}`)
  const again = parseOk(out, 'txt')
  const pre2 = findEntry(asBlock(findAllEntries(asBlock(findEntry(again.items, 'focus_tree')!).items, 'focus')[1]).items, 'prerequisite')!
  assert.equal(asBlock(pre2).items.length, 2)
  assert.equal(serialize(again), out)
})

test('键与等号之间无空格（紧凑写法）', () => {
  const src = 'x=1\ny="s"\n'
  const file = parseOk(src, 'txt')
  assert.equal(serialize(file), src)
  const x = findEntry(file.items, 'x')!
  setString(x, '2')
  const out = serialize(file)
  assert.ok(out.includes('x = 2'))
  assert.equal(serialize(parseOk(out, 'txt')), out)
})

test('单行裸值列表：删除其中一项后重渲染跳过已删项', () => {
  const src = 'prerequisite = { a b c }\n'
  const file = parseOk(src, 'txt')
  const pr = findEntry(file.items, 'prerequisite')!
  assert.ok(pr.value && pr.value.kind === 'block')
  const b = pr.value.items.find((x) => x.value?.kind === 'scalar' && x.value.token.text === 'b')
  assert.ok(b)
  b.deleted = true
  pr.dirty = true
  assert.equal(serialize(file), 'prerequisite = { a c }\n')
})

test('单行裸值列表：全删后空块仍可渲染', () => {
  const src = 'prerequisite = { a }\n'
  const file = parseOk(src, 'txt')
  const pr = findEntry(file.items, 'prerequisite')!
  assert.ok(pr.value && pr.value.kind === 'block')
  pr.value.items[0].deleted = true
  pr.dirty = true
  const out = serialize(file)
  assert.ok(!out.includes('a'))
  // 空块渲染为多行（valid HOI4）
  assert.equal(serialize(parseOk(out, 'txt')), out)
})
