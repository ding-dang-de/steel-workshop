import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  loadLoc,
  saveLoc,
  setLocText,
  addLocKey,
  deleteLocKey,
  extractFocusIds,
  checkMissingFocusLoc,
  fillMissingFocusLoc,
  unescapeYmlText,
  escapeYmlText
} from './localisation.ts'

// 用户真实文件的格式：`key: "文本"`（冒号后无版本号）
const SRC = `l_simp_chinese:
 FRA_land_reform: "土地改革"
 FRA_land_reform_desc: "耕者有其田。"
 FRA_placeholder: "FRA_placeholder"
 FRA_empty: ""
`

test('解析：语言头不算条目，键/版本/占位识别正确（无版本号格式）', () => {
  const loc = loadLoc(SRC)
  assert.ok(loc)
  assert.equal(loc.errors.length, 0)
  assert.equal(loc.entries.length, 4)
  const e = loc.byKey.get('FRA_land_reform')
  assert.ok(e)
  assert.equal(e.key, 'FRA_land_reform')
  assert.equal(e.version, '')
  assert.equal(e.fullKey, 'FRA_land_reform:')
  assert.equal(e.text, '土地改革')
  assert.equal(e.placeholder, false)
  assert.equal(loc.byKey.get('FRA_placeholder')?.placeholder, true)
  assert.equal(loc.byKey.get('FRA_empty')?.placeholder, true)
  // 语言头不是可翻译条目
  assert.equal(loc.byKey.has('l_simp_chinese'), false)
})

test('解析：香草 key:0 格式同样支持', () => {
  const loc = loadLoc('l_english:\n K:0 "甲"\n K2:1 "乙"\n')
  assert.ok(loc)
  assert.deepEqual(
    loc.entries.map((e) => [e.key, e.version, e.text]),
    [
      ['K', '0', '甲'],
      ['K2', '1', '乙']
    ]
  )
})

test('无损往返：解析后重新序列化逐字节一致', () => {
  assert.equal(saveLoc(loadLoc(SRC)!), SRC)
})

test('无损往返：BOM + CRLF + 注释原样保留', () => {
  const src = '﻿l_simp_chinese:\r\n # 注释行\r\n FRA_a: "甲"\r\n\r\n FRA_b: "乙" # 行尾注释\r\n'
  const loc = loadLoc(src)
  assert.ok(loc)
  assert.equal(loc.errors.length, 0)
  assert.equal(saveLoc(loc), src)
  assert.deepEqual(
    loc.entries.map((e) => e.key),
    ['FRA_a', 'FRA_b']
  )
})

test('修改一条文本：只有那一行变化，其余字节原样', () => {
  const loc = loadLoc(SRC)
  assert.ok(loc)
  assert.equal(setLocText(loc, 'FRA_land_reform', '新的土地改革'), true)
  assert.equal(setLocText(loc, 'NOT_EXIST', 'x'), false)
  const out = saveLoc(loc)
  assert.equal(out, SRC.replace('FRA_land_reform: "土地改革"', 'FRA_land_reform: "新的土地改革"'))
  // 占位状态同步更新
  assert.equal(loc.byKey.get('FRA_land_reform')?.placeholder, false)
  setLocText(loc, 'FRA_land_reform', 'FRA_land_reform')
  assert.equal(loc.byKey.get('FRA_land_reform')?.placeholder, true)
})

test('修改文本：引号与反斜杠转义往返', () => {
  const loc = loadLoc('l_english:\n K: "甲"\n')
  assert.ok(loc)
  setLocText(loc, 'K', '他说"你好"\\再见')
  const out = saveLoc(loc)
  assert.equal(out, 'l_english:\n K: "他说\\"你好\\"\\\\再见"\n')
  // 重新解析读回一致
  const again = loadLoc(out)
  assert.ok(again)
  assert.equal(again.byKey.get('K')?.text, '他说"你好"\\再见')
  assert.equal(saveLoc(again), out)
})

test('追加新键：沿用无版本号惯例，既有内容原样', () => {
  const loc = loadLoc(SRC)
  assert.ok(loc)
  assert.equal(addLocKey(loc, 'FRA_new', '新国策'), true)
  assert.equal(addLocKey(loc, 'FRA_new', '重复'), false) // 已存在则忽略
  const out = saveLoc(loc)
  assert.equal(out, SRC + ' FRA_new: "新国策"\n')
  assert.equal(loc.byKey.get('FRA_new')?.text, '新国策')
})

test('追加新键：key:0 为主的文件沿用 :0 惯例', () => {
  const loc = loadLoc('l_english:\n K:0 "甲"\n K2:0 "乙"\n')
  assert.ok(loc)
  addLocKey(loc, 'K3', '丙')
  assert.equal(saveLoc(loc), 'l_english:\n K:0 "甲"\n K2:0 "乙"\n K3:0 "丙"\n')
})

test('追加到无末尾换行的文件：补出新行且结尾带换行', () => {
  const src = 'l_english:\n K: "甲"'
  const loc = loadLoc(src)
  assert.ok(loc)
  addLocKey(loc, 'K2', '乙')
  assert.equal(saveLoc(loc), 'l_english:\n K: "甲"\n K2: "乙"\n')
})

test('追加到空文件（只有语言头）：首行不产生空行', () => {
  const src = 'l_english:\n'
  const loc = loadLoc(src)
  assert.ok(loc)
  addLocKey(loc, 'K', '甲')
  assert.equal(saveLoc(loc), 'l_english:\n K: "甲"\n')
})

test('删除键：整行消失，其余原样', () => {
  const loc = loadLoc(SRC)
  assert.ok(loc)
  assert.equal(deleteLocKey(loc, 'FRA_empty'), true)
  assert.equal(deleteLocKey(loc, 'NOT_EXIST'), false)
  const out = saveLoc(loc)
  assert.ok(!out.includes('FRA_empty'))
  assert.ok(out.includes('FRA_land_reform: "土地改革"\n'))
  assert.ok(out.includes('FRA_placeholder: "FRA_placeholder"\n'))
})

test('国策联动：提取 id、检测缺失、一键补全', () => {
  const tree = `focus_tree = {
\tid = fra_tree
\tfocus = {
\t\tid = fra_one
\t\tx = 0
\t\ty = 0
\t}
\tfocus = {
\t\tid = fra_two
\t\tx = 0
\t\ty = 1
\t}
}
`
  const ids = extractFocusIds(tree)
  assert.deepEqual(ids, ['fra_one', 'fra_two'])

  const loc = loadLoc('l_simp_chinese:\n fra_one: "第一"\n')
  assert.ok(loc)
  const missing = checkMissingFocusLoc(loc, ids)
  assert.deepEqual(missing, [
    { id: 'fra_one', missingName: false, missingDesc: true },
    { id: 'fra_two', missingName: true, missingDesc: true }
  ])

  assert.equal(fillMissingFocusLoc(loc, ids), 3)
  const out = saveLoc(loc)
  assert.ok(out.includes('fra_one: "第一"'))
  assert.ok(out.includes('fra_one_desc: ""'))
  assert.ok(out.includes('fra_two: "fra_two"'))
  assert.ok(out.includes('fra_two_desc: ""'))
  // 补全后不再缺失
  assert.equal(checkMissingFocusLoc(loc, ids).length, 0)
  // 名称占位、描述空文本都标记为占位
  assert.equal(loc.byKey.get('fra_two')?.placeholder, true)
  assert.equal(loc.byKey.get('fra_two_desc')?.placeholder, true)
  // 整体无损：原有行原样
  assert.ok(out.startsWith('l_simp_chinese:\n fra_one: "第一"\n'))
})

test('转义辅助函数', () => {
  assert.equal(unescapeYmlText('"甲\\"乙\\\\丙"'), '甲"乙\\丙')
  assert.equal(escapeYmlText('甲"乙\\丙'), '甲\\"乙\\\\丙')
})
