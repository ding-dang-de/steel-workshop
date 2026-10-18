import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseFile } from './clausewitz.ts'
import type { CwBlock } from './clausewitz.ts'
import { hasCjk } from './cjk.ts'
import {
  COND_CATALOG,
  CAT_ZH,
  condSpec,
  condSpecsByCat,
  parseCondBlock,
  renderCondNodes,
  condBlockText,
  isCondOperator,
  makeCondNode,
  suggestCondKeys
} from './conditions.ts'

function blockOf(src: string): CwBlock {
  const parsed = parseFile(src, 'txt').file
  assert.ok(parsed, '解析失败')
  const it = parsed.items[0]
  assert.ok(it?.value?.kind === 'block')
  return it.value
}

test('parseCondBlock：标量成参数、块成子节点、可嵌套', () => {
  const block = blockOf(`available = {
\thas_war = yes
\thas_stability > 0.5
\tAND = {
\t\tis_major = yes
\t\tNOT = { has_government = fascism }
\t}
}`)
  assert.deepEqual(parseCondBlock(block), [
    { key: 'has_war', args: ['yes'], children: [] },
    { key: 'has_stability', args: ['>', '0.5'], children: [] },
    {
      key: 'AND',
      args: [],
      children: [
        { key: 'is_major', args: ['yes'], children: [] },
        { key: 'NOT', args: [], children: [{ key: 'has_government', args: ['fascism'], children: [] }] }
      ]
    }
  ])
})

test('parseCondBlock：跳过已删除条目；random_list 的同键块各成节点', () => {
  const parsed = parseFile(`x = {
\t50 = { add_stability = 0.1 }
\t50 = { }
}`, 'txt').file
  const block = parsed!.items[0].value as CwBlock
  block.items[1].deleted = true // 删掉第二个 50，保留有内容的
  const nodes = parseCondBlock(block)
  assert.equal(nodes.length, 1)
  assert.equal(nodes[0].key, '50')
  assert.deepEqual(nodes[0].children, [{ key: 'add_stability', args: ['0.1'], children: [] }])
})

test('renderCondNodes：深度缩进、单行标量、嵌套块闭合', () => {
  const nodes = [
    { key: 'has_war', args: ['yes'], children: [] },
    { key: 'if', args: [], children: [
      { key: 'limit', args: [], children: [{ key: 'is_puppet', args: ['yes'], children: [] }] },
      { key: 'add_political_power', args: ['100'], children: [] }
    ] }
  ]
  assert.equal(
    renderCondNodes(nodes),
    [
      'has_war = yes',
      'if = {',
      '\tlimit = {',
      '\t\tis_puppet = yes',
      '\t}',
      '\tadd_political_power = 100',
      '}'
    ].join('\n')
  )
  assert.equal(
    condBlockText('available', nodes),
    'available = {\n\thas_war = yes\n\tif = {\n\t\tlimit = {\n\t\t\tis_puppet = yes\n\t\t}\n\t\tadd_political_power = 100\n\t}\n}'
  )
})

test('渲染往返：renderCondNodes(parseCondBlock(x)) 结构一致', () => {
  const src = `available = {
\thas_manpower > 50000
\tOR = {
\t\thas_idea = my_idea
\t\tcheck_variable = { my_var > 10 }
\t}
}`
  const nodes = parseCondBlock(blockOf(src))
  const reParsed = parseCondBlock(blockOf(condBlockText('available', nodes)))
  assert.deepEqual(reParsed, nodes)
  // 规范化后按深度缩进
  assert.equal(
    condBlockText('available', nodes),
    'available = {\n\thas_manpower > 50000\n\tOR = {\n\t\thas_idea = my_idea\n\t\tcheck_variable = {\n\t\t\tmy_var > 10\n\t\t}\n\t}\n}'
  )
})

test('目录：键唯一、中文说明齐全、enum 参数有候选值、逻辑键覆盖', () => {
  const keys = COND_CATALOG.map((s) => s.key)
  assert.equal(new Set(keys).size, keys.length)
  for (const s of COND_CATALOG) {
    assert.ok(s.zh.length > 0, `${s.key} 缺中文说明`)
    assert.ok(['effect', 'trigger', 'logic'].includes(s.kind))
    for (const p of s.params ?? []) {
      if (p.kind === 'enum') assert.ok(p.values && p.values.length > 0, `${s.key}.${p.name} 缺候选值`)
    }
  }
  // 常见条目存在且分类正确
  assert.equal(condSpec('has_war')?.kind, 'trigger')
  assert.equal(condSpec('add_stability')?.kind, 'effect')
  assert.equal(condSpec('if')?.kind, 'logic')
  assert.equal(condSpec('不存在的东西'), undefined)
  // 分类分组覆盖全部条目
  const grouped = condSpecsByCat()
  assert.equal(grouped.reduce((n, g) => n + g.list.length, 0), COND_CATALOG.length)
  // 对照表页签不变式：分类名唯一，且每个分类都至少有一条（否则页签计数恒为 0）
  const zhVals = Object.values(CAT_ZH)
  assert.equal(new Set(zhVals).size, zhVals.length)
  for (const zh of zhVals) assert.ok(COND_CATALOG.some((s) => CAT_ZH[s.cat] === zh), `分类「${zh}」没有条目`)
})

test('比较运算符识别', () => {
  for (const op of ['>', '<', '>=', '<=', '=', '!=']) assert.ok(isCondOperator(op))
  assert.ok(!isCondOperator('yes'))
  assert.ok(!isCondOperator('0.5'))
})

test('makeCondNode 生成空节点', () => {
  assert.deepEqual(makeCondNode('has_war'), { key: 'has_war', args: [], children: [] })
})

// ---------- suggestCondKeys / hasCjk ----------

test('suggestCondKeys：空输入返回空；英文前缀/包含与目录匹配', () => {
  assert.deepEqual(suggestCondKeys(''), [])
  assert.deepEqual(suggestCondKeys('   '), [])
  const pre = suggestCondKeys('add_sta')
  assert.equal(pre[0].key, 'add_stability')
  assert.ok(pre.every((s) => s.key.toLowerCase().startsWith('add_sta')))
  assert.ok(suggestCondKeys('stability').some((s) => s.key === 'add_stability'))
})

test('suggestCondKeys：中文按说明搜索，结果键都是 ASCII', () => {
  const r = suggestCondKeys('政治点数')
  assert.equal(r[0].key, 'has_political_power')
  assert.ok(r.some((s) => s.key === 'add_political_power'))
  for (const s of r) assert.match(s.key, /^[A-Za-z0-9_]+$/)
})

test('suggestCondKeys：中文前缀档优先（增加政治 → add_political_power）', () => {
  const r = suggestCondKeys('增加政治')
  assert.equal(r.length, 1)
  assert.equal(r[0].key, 'add_political_power')
})

test('suggestCondKeys：分类名精确命中（军事 → 军事分类条目在前）', () => {
  const r = suggestCondKeys('军事')
  assert.equal(r[0].key, 'add_army_experience')
  assert.equal(r[0].cat, 'military')
})

test('suggestCondKeys：limit 生效；无匹配中文返回空；混合串无结果', () => {
  assert.equal(suggestCondKeys('add_', 3).length, 3)
  assert.deepEqual(suggestCondKeys('不存在的中文词'), [])
  assert.deepEqual(suggestCondKeys('add_stability中'), [])
})

test('hasCjk：中文/全角标点命中，ASCII 不命中', () => {
  assert.ok(hasCjk('军事'))
  assert.ok(hasCjk('abc中'))
  assert.ok(hasCjk('，。！'))
  assert.ok(hasCjk('ｱ'))
  assert.ok(!hasCjk('add_stability'))
  assert.ok(!hasCjk(''))
  assert.ok(!hasCjk('a > 0.5'))
})
