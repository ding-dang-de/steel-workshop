import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  loadFocusTree,
  saveFocusTree,
  buildNodes,
  setFocusPos,
  setFocusCost,
  setFocusIcon,
  setRelativePositionId,
  setAvailableIfCapitulated,
  renameFocus,
  addFocus,
  deleteFocus,
  togglePrerequisite,
  setStringList,
  suggestFocusId,
  getFocusCondBlock,
  setFocusCondBlock,
  setCancelIfInvalid,
  getFocusFiredEvents,
  addFocusFiredEvent,
  removeFocusFiredEvent,
  getShortcuts,
  addShortcut,
  removeShortcut,
  setShortcutName,
  setShortcutTarget,
  setShortcutScrollFactor,
  getShortcutTrigger,
  setShortcutTrigger
} from './focusTree.ts'
import { parseFile, serialize } from './clausewitz.ts'

const SRC = `focus_tree = {
\t# 法国重做国策树
\tid = fra_tree

\tfra_start = {
\t\tx = 0
\t\ty = 0
\t\tcost = 10
\t\ticon = GFX_goal_generic_construct_civilian
\t\trelative_position_id = fra_second
\t}

\tfra_second = {
\t\tx = 1
\t\ty = 0
\t\tcost = 10
\t\tprerequisite = { fra_start }
\t\tavailable_if_capitulated = yes
\t\tsearch_filters = { FOCUS_FILTER_POLITICAL FOCUS_FILTER_ANNEXATION }
\t}
}
`

test('解析：节点字段与列表', () => {
  const m = loadFocusTree(SRC)
  assert.ok(m)
  assert.equal(m.errors.length, 0)
  assert.equal(m.nodes.length, 2)
  const start = m.nodes.find((n) => n.id === 'fra_start')
  assert.ok(start)
  assert.equal(start.x, 0)
  assert.equal(start.y, 0)
  assert.equal(start.cost, 10)
  assert.equal(start.icon, 'GFX_goal_generic_construct_civilian')
  assert.equal(start.relativePositionId, 'fra_second')
  const second = m.nodes.find((n) => n.id === 'fra_second')
  assert.ok(second)
  assert.deepEqual(second.prerequisites, ['fra_start'])
  assert.equal(second.availableIfCapitulated, true)
  assert.deepEqual(second.searchFilters, ['FOCUS_FILTER_POLITICAL', 'FOCUS_FILTER_ANNEXATION'])
})

test('改 cost：只重写被改条目，其它字节原样保留', () => {
  const m = loadFocusTree(SRC)
  assert.ok(m)
  const start = buildNodes(m.root).find((n) => n.id === 'fra_start')
  assert.ok(start)
  setFocusCost(start.entry, 25)
  const out = saveFocusTree(m)
  // 改动的行
  assert.ok(out.includes('\t\tcost = 25\n'))
  // 未改动的行保持原样（含注释与缩进）
  assert.ok(out.includes('\t# 法国重做国策树\n'))
  assert.ok(out.includes('\t\ticon = GFX_goal_generic_construct_civilian\n'))
  // 只有 cost 行变了：删除 cost = 10 后其余完全一致
  const expected = SRC.replace('\t\tcost = 10\n', '\t\tcost = 25\n')
  assert.equal(out, expected)
})

test('移动位置 / 改图标 / 加 relative_position_id', () => {
  const m = loadFocusTree(SRC)
  assert.ok(m)
  const second = buildNodes(m.root).find((n) => n.id === 'fra_second')
  assert.ok(second)
  setFocusPos(second.entry, 3, 2)
  setFocusIcon(second.entry, 'GFX_goal_generic_support_democracy')
  const out = saveFocusTree(m)
  assert.ok(out.includes('\t\tx = 3\n\t\ty = 2\n'))
  assert.ok(out.includes('\t\ticon = GFX_goal_generic_support_democracy\n'))
  // 未碰过的内容不变
  assert.ok(out.includes('prerequisite = { fra_start }'))
  assert.ok(out.includes('search_filters = { FOCUS_FILTER_POLITICAL FOCUS_FILTER_ANNEXATION }'))
})

test('prerequisite 切换：删除后条目消失，重新加回恢复单行写法', () => {
  const m = loadFocusTree(SRC)
  assert.ok(m)
  const second = buildNodes(m.root).find((n) => n.id === 'fra_second')
  assert.ok(second)
  togglePrerequisite(second.entry, 'fra_start') // 移除
  assert.ok(!saveFocusTree(m).includes('prerequisite'))
  togglePrerequisite(second.entry, 'fra_start') // 加回
  const out = saveFocusTree(m)
  assert.ok(out.includes('\t\tprerequisite = { fra_start }\n'))
})

test('addFocus 后 deleteFocus：字节完全还原', () => {
  const m = loadFocusTree(SRC)
  assert.ok(m)
  const before = saveFocusTree(m)
  addFocus(m, 'fra_third', 2, 1)
  const withNew = saveFocusTree(m)
  assert.ok(withNew.includes('focus = {\n\t\tid = fra_third'))
  assert.ok(withNew.includes('\t\tx = 2\n\t\ty = 1\n'))
  // 既有内容不受影响
  assert.ok(withNew.includes('\t# 法国重做国策树\n'))
  deleteFocus(m, 'fra_third')
  assert.equal(saveFocusTree(m), before)
})

test('deleteFocus 清理其它节点的引用', () => {
  const m = loadFocusTree(SRC)
  assert.ok(m)
  deleteFocus(m, 'fra_start')
  const out = saveFocusTree(m)
  assert.ok(!out.includes('fra_start'))
  // fra_second 的 prerequisite 与 fra_start 的 relative_position_id 都清理了
  assert.ok(!out.includes('prerequisite'))
  assert.ok(!out.includes('relative_position_id'))
})

test('renameFocus 只改键名，引用不变（由编辑器层处理引用）', () => {
  const m = loadFocusTree(SRC)
  assert.ok(m)
  const start = buildNodes(m.root).find((n) => n.id === 'fra_start')
  assert.ok(start)
  renameFocus(start.entry, 'fra_begin')
  const out = saveFocusTree(m)
  assert.ok(out.includes('fra_begin = {'))
  assert.ok(!out.includes('fra_start = {'))
  assert.equal(out.replace('fra_begin = {', 'fra_start = {'), SRC)
})

test('cancel_if_invalid 读取与切换', () => {
  const src = `focus_tree = {
\tfra_a = {
\t\tx = 0
\t\ty = 0
\t\tcancel_if_invalid = yes
\t}
}
`
  const m = loadFocusTree(src)
  assert.ok(m)
  const a = buildNodes(m.root).find((n) => n.id === 'fra_a')
  assert.ok(a)
  assert.equal(a.cancelIfInvalid, true)
  setCancelIfInvalid(a.entry, false)
  assert.ok(!saveFocusTree(m).includes('cancel_if_invalid'))
  setCancelIfInvalid(a.entry, true)
  assert.ok(saveFocusTree(m).includes('\t\tcancel_if_invalid = yes\n'))
})

test('available_if_capitulated 关闭后条目删除，打开后恢复 yes', () => {
  const m = loadFocusTree(SRC)
  assert.ok(m)
  const second = buildNodes(m.root).find((n) => n.id === 'fra_second')
  assert.ok(second)
  setAvailableIfCapitulated(second.entry, false)
  assert.ok(!saveFocusTree(m).includes('available_if_capitulated'))
  setAvailableIfCapitulated(second.entry, true)
  assert.ok(saveFocusTree(m).includes('\t\tavailable_if_capitulated = yes\n'))
})

test('relative_position_id 置空删除条目', () => {
  const m = loadFocusTree(SRC)
  assert.ok(m)
  const start = buildNodes(m.root).find((n) => n.id === 'fra_start')
  assert.ok(start)
  setRelativePositionId(start.entry, null)
  assert.ok(!saveFocusTree(m).includes('relative_position_id'))
})

test('撤销快照：serialize → load → serialize 字节一致', () => {
  const m = loadFocusTree(SRC)
  assert.ok(m)
  const snap = saveFocusTree(m)
  setFocusPos(buildNodes(m.root)[0].entry, 9, 9)
  assert.notEqual(saveFocusTree(m), snap)
  const restored = loadFocusTree(snap)
  assert.ok(restored)
  assert.equal(saveFocusTree(restored), snap)
})

test('suggestFocusId 避开已占用 id', () => {
  const m = loadFocusTree(SRC)
  assert.ok(m)
  assert.equal(suggestFocusId(m, 'fra_start'), 'fra_start_1')
  assert.equal(suggestFocusId(m, 'new_focus'), 'new_focus')
})

test('setStringList 空列表删除条目，非空恢复单行裸列表', () => {
  const m = loadFocusTree(SRC)
  assert.ok(m)
  const second = buildNodes(m.root).find((n) => n.id === 'fra_second')
  assert.ok(second)
  setStringList(second.entry, 'search_filters', [])
  assert.ok(!saveFocusTree(m).includes('search_filters'))
  setStringList(second.entry, 'search_filters', ['FOCUS_FILTER_POLITICAL'])
  const out = saveFocusTree(m)
  assert.ok(out.includes('\t\tsearch_filters = { FOCUS_FILTER_POLITICAL }\n'))
})

test('坐标解析：relative_position_id 默认在下方一格，offset 叠加，无坐标的自动排开', () => {
  const src = `focus_tree = {
\tfra_base = {
\t\tx = 0
\t\ty = 0
\t}
\tfra_below = {
\t\trelative_position_id = fra_base
\t}
\tfra_shifted = {
\t\trelative_position_id = fra_base
\t\toffset = {
\t\t\tx = 2
\t\t\ty = 1
\t\t}
\t}
\tfra_orphan = {
\t}
}
`
  const m = loadFocusTree(src)
  assert.ok(m)
  assert.equal(m.errors.length, 0)
  const at = (id: string): { x: number; y: number } => {
    const n = m.nodes.find((x) => x.id === id)
    assert.ok(n, `缺少节点 ${id}`)
    return { x: n.x, y: n.y }
  }
  assert.deepEqual(at('fra_base'), { x: 0, y: 0 })
  assert.deepEqual(at('fra_below'), { x: 0, y: 1 })
  assert.deepEqual(at('fra_shifted'), { x: 2, y: 1 })
  // 无任何坐标线索：自动排到最右列再往右的空闲格，不堆在原点
  const orphan = at('fra_orphan')
  assert.ok(orphan.x >= 2, `孤儿节点应远离原点，得到 (${orphan.x}, ${orphan.y})`)
  assert.equal(orphan.y, 0)
  // 解析出的位置不写回文件（保持无损）
  assert.equal(saveFocusTree(m), src)
})

test('setFocusCondBlock：单行 available 整块替换为规范多行，其它内容原样', () => {
  const src = `focus_tree = {
\tfra_a = {
\t\tx = 0
\t\ty = 0
\t\tavailable = { has_war = yes }
\t}
\tfra_b = {
\t\tx = 1
\t\ty = 0
\t\tcost = 10
\t}
}
`
  const m = loadFocusTree(src)
  assert.ok(m)
  const a = buildNodes(m.root).find((n) => n.id === 'fra_a')
  assert.ok(a)
  assert.deepEqual(getFocusCondBlock(a.entry, 'available'), [{ key: 'has_war', args: ['yes'], children: [] }])
  assert.equal(getFocusCondBlock(a.entry, 'completion_reward'), null)
  setFocusCondBlock(a.entry, 'available', [
    { key: 'has_war', args: ['yes'], children: [] },
    { key: 'AND', args: [], children: [{ key: 'is_major', args: ['yes'], children: [] }] }
  ])
  const out = saveFocusTree(m)
  assert.ok(
    out.includes('\t\tavailable = {\n\t\t\thas_war = yes\n\t\t\tAND = {\n\t\t\t\tis_major = yes\n\t\t\t}\n\t\t}\n'),
    `available 块应为规范多行，实际：\n${out}`
  )
  // fra_a 的 x/y 行与整个 fra_b 块保持原样
  assert.ok(out.includes('\t\tx = 0\n\t\ty = 0\n'))
  assert.ok(out.includes('fra_b = {\n\t\tx = 1\n\t\ty = 0\n\t\tcost = 10\n\t}\n'))
})

test('setFocusCondBlock：空节点删除块，可重新创建，撤销快照字节一致', () => {
  const src = `focus_tree = {
\tfra_a = {
\t\tx = 0
\t\ty = 0
\t\tavailable = { has_war = yes }
\t}
}
`
  const m = loadFocusTree(src)
  assert.ok(m)
  const snap = saveFocusTree(m)
  const a = buildNodes(m.root).find((n) => n.id === 'fra_a')
  assert.ok(a)
  // 删除
  setFocusCondBlock(a.entry, 'available', [])
  assert.ok(!saveFocusTree(m).includes('available'))
  // 重新创建（追加到块尾）
  setFocusCondBlock(a.entry, 'completion_reward', [{ key: 'add_stability', args: ['0.1'], children: [] }])
  const out = saveFocusTree(m)
  assert.ok(out.includes('\t\tcompletion_reward = {\n\t\t\tadd_stability = 0.1\n\t\t}\n'))
  // 撤销
  const restored = loadFocusTree(snap)
  assert.ok(restored)
  assert.equal(saveFocusTree(restored), snap)
})

test('CRLF 文件：交换块保留 \\r\\n，比较式触发器不散行', () => {
  const src = 'focus_tree = {\r\n\tfra_a = {\r\n\t\tx = 0\r\n\t\ty = 0\r\n\t\tavailable = { has_war = yes }\r\n\t}\r\n}\r\n'
  const m = loadFocusTree(src)
  assert.ok(m)
  assert.equal(m.errors.length, 0)
  const a = buildNodes(m.root).find((n) => n.id === 'fra_a')
  assert.ok(a)
  setFocusCondBlock(a.entry, 'available', [
    { key: 'has_war', args: ['yes'], children: [] },
    { key: 'has_stability', args: ['>', '0.5'], children: [] }
  ])
  const out = saveFocusTree(m)
  // 换行符保持 \r\n；比较式保持 key > value 单行
  assert.ok(
    out.includes('\t\tavailable = {\r\n\t\t\thas_war = yes\r\n\t\t\thas_stability > 0.5\r\n\t\t}\r\n'),
    `实际：\n${JSON.stringify(out)}`
  )
  assert.ok(!out.includes('has_stability\r\n\t\t\t>'))
  // 其余行原样
  assert.ok(out.includes('focus_tree = {\r\n\tfra_a = {\r\n\t\tx = 0\r\n\t\ty = 0\r\n'))
  // 撤销往返
  const restored = loadFocusTree(src)
  assert.ok(restored)
  assert.equal(saveFocusTree(restored), src)
})

test('真实格式：改 focus = { id = X } 内的 available，其它国策不动', () => {
  const src = `focus_tree = {
\tid = FRA
\tfocus = {
\t\tid = fra_one
\t\tx = 22
\t\ty = 1
\t\tavailable = { has_war = yes }
\t}
\tfocus = {
\t\tid = fra_two
\t\tx = 22
\t\ty = 2
\t}
}
`
  const m = loadFocusTree(src)
  assert.ok(m)
  assert.equal(m.errors.length, 0)
  const one = m.nodes.find((n) => n.id === 'fra_one')
  assert.ok(one)
  setFocusCondBlock(one.entry, 'available', [{ key: 'has_civil_war', args: ['yes'], children: [] }])
  const out = saveFocusTree(m)
  assert.ok(out.includes('\t\tavailable = {\n\t\t\thas_civil_war = yes\n\t\t}\n'))
  assert.ok(!out.includes('has_war'))
  assert.ok(out.includes('\t\tid = fra_one\n\t\tx = 22\n\t\ty = 1\n'))
  assert.ok(out.includes('\t\tid = fra_two\n\t\tx = 22\n\t\ty = 2\n'))
})

test('真实格式 focus = { id = X }：内部 id、坐标互不串扰、country 不算国策', () => {
  const src = `focus_tree = {
\tid = FRA
\tcountry = {
\t\tfactor = 0
\t}
\tdefault = no
\tfocus = {
\t\tid = fra_one
\t\tx = 22
\t\ty = 1
\t}
\tfocus = {
\t\tid = fra_two
\t\tx = 22
\t\ty = 2
\t\tprerequisite = { focus = fra_one }
\t}
\tfocus = {
\t\tid = fra_three
\t\trelative_position_id = fra_two
\t}
}
`
  const m = loadFocusTree(src)
  assert.ok(m)
  assert.equal(m.errors.length, 0)
  // country 块不是国策；id 取块内 id = X
  assert.deepEqual(m.nodes.map((n) => n.id), ['fra_one', 'fra_two', 'fra_three'])
  const at = (id: string): { x: number; y: number } => {
    const n = m.nodes.find((x) => x.id === id)
    assert.ok(n, `缺少节点 ${id}`)
    return { x: n.x, y: n.y }
  }
  // 每个国策的坐标互不串扰（回归：曾因按块键名缓存而全部叠在第一个国策的位置）
  assert.deepEqual(at('fra_one'), { x: 22, y: 1 })
  assert.deepEqual(at('fra_two'), { x: 22, y: 2 })
  assert.deepEqual(at('fra_three'), { x: 22, y: 3 })
  // prerequisite 引用内部 id
  assert.deepEqual(m.nodes[1].prerequisites, ['fra_one'])
  // 重命名改的是块内 id
  renameFocus(m.nodes[0].entry, 'fra_start')
  const renamed = saveFocusTree(m)
  assert.ok(renamed.includes('\t\tid = fra_start\n'))
  assert.ok(!renamed.includes('id = fra_one'))
  // 删除按 id 命中并清理引用（fra_three 的 relative_position_id 指向 fra_two）
  deleteFocus(m, 'fra_two')
  const out = saveFocusTree(m)
  assert.ok(!out.includes('id = fra_two'))
  assert.ok(!out.includes('focus = fra_two'))
  assert.ok(!out.includes('relative_position_id'))
})

// ---------- 完成时触发事件（与事件编辑器联动） ----------

const FIRE_SRC = `focus_tree = {
\tid = fire_tree

\tfire_one = {
\t\tx = 0
\t\ty = 0
\t\tcost = 70
\t\tcompletion_reward = {
\t\t\tadd_political_power = 100
\t\t\tcountry_event = { id = FRA.1 }
\t\t\tfire_events = { FRA.2 FRA.3 }
\t\t\tnews_event = { id = FRA.4 }
\t\t}
\t}

\tfire_two = {
\t\tx = 1
\t\ty = 0
\t\tcost = 10
\t}
}
`

test('触发事件：读取完成效果里的事件引用', () => {
  const m = loadFocusTree(FIRE_SRC)
  assert.ok(m)
  const one = m.nodes.find((n) => n.id === 'fire_one')
  assert.ok(one)
  const fired = getFocusFiredEvents(one.entry)
  assert.deepEqual(fired, [
    { effectKey: 'country_event', id: 'FRA.1' },
    { effectKey: 'fire_events', id: 'FRA.2' },
    { effectKey: 'fire_events', id: 'FRA.3' },
    { effectKey: 'news_event', id: 'FRA.4' }
  ])
  // 没有完成效果的国策返回空
  const two = m.nodes.find((n) => n.id === 'fire_two')
  assert.ok(two)
  assert.deepEqual(getFocusFiredEvents(two.entry), [])
})

test('触发事件：添加/移除只动完成效果块，未动部分逐字保留', () => {
  const m = loadFocusTree(FIRE_SRC)
  assert.ok(m)
  const one = m.nodes.find((n) => n.id === 'fire_one')
  assert.ok(one)
  // 添加（完成效果块整体规范化为多行，事件编辑器同款格式）
  addFocusFiredEvent(one.entry, 'FRA.9')
  const added = saveFocusTree(m)
  assert.ok(added.includes('country_event = {\n\t\t\t\tid = FRA.9'))
  assert.ok(added.includes('fire_two = {'), '未动的国策保留')
  assert.ok(added.includes('\t\tx = 1\n\t\ty = 0\n\t\tcost = 10'), 'fire_two 内部字节不变')
  assert.ok(added.includes('add_political_power = 100'))
  // 序列化往返无损
  const parsedAdded = parseFile(added, 'txt').file
  assert.ok(parsedAdded)
  assert.equal(serialize(parsedAdded), added)
  // 移除新增的
  removeFocusFiredEvent(one.entry, 'FRA.9')
  const removed = saveFocusTree(m)
  assert.ok(!removed.includes('FRA.9'))
  // 移除 fire_events 里的一个 id：只剔除该项，其余保留
  removeFocusFiredEvent(one.entry, 'FRA.2')
  const trimmed = saveFocusTree(m)
  assert.ok(!trimmed.includes('FRA.2'))
  assert.ok(trimmed.includes('FRA.3'))
  assert.ok(trimmed.includes('fire_events'))
  // 移除 country_event：整条效果删除，其它条目保留
  removeFocusFiredEvent(one.entry, 'FRA.1')
  const noCountry = saveFocusTree(m)
  assert.ok(!noCountry.includes('country_event'))
  assert.ok(noCountry.includes('news_event = {\n\t\t\t\tid = FRA.4'))
})

test('触发事件：无完成效果时一键添加会自动建块', () => {
  const m = loadFocusTree(FIRE_SRC)
  assert.ok(m)
  const two = m.nodes.find((n) => n.id === 'fire_two')
  assert.ok(two)
  addFocusFiredEvent(two.entry, 'FRA.7')
  const out = saveFocusTree(m)
  assert.ok(out.includes('\t\tcompletion_reward = {\n\t\t\tcountry_event = {\n\t\t\t\tid = FRA.7\n\t\t\t}\n\t\t}'))
  // 序列化往返无损
  const parsedOut = parseFile(out, 'txt').file
  assert.ok(parsedOut)
  assert.equal(serialize(parsedOut), out)
})

// ---------- 快捷路径（shortcut，1.15+ 国策树翻页） ----------

const SC_SRC = `focus_tree = {
\tid = fra_tree

\tshortcut = {
\t\tname = fra_sc_next
\t\ttarget = fra_second
\t\tscroll_wheel_factor = 0.75
\t\ttrigger = { has_war = yes }
\t}

\tinlay_window = {
\t\tname = fra_inlay
\t}

\tfra_start = {
\t\tx = 0
\t\ty = 0
\t}

\tfra_second = {
\t\tx = 1
\t\ty = 0
\t}
}
`

test('快捷路径：buildNodes 过滤 shortcut/inlay_window（回归：曾被误识别为国策）', () => {
  const m = loadFocusTree(SC_SRC)
  assert.ok(m)
  assert.equal(m.errors.length, 0)
  assert.deepEqual(m.nodes.map((n) => n.id), ['fra_start', 'fra_second'])
  // 无损：不修改任何内容
  assert.equal(saveFocusTree(m), SC_SRC)
})

test('快捷路径：读取字段，可选字段缺失返回 null', () => {
  const m = loadFocusTree(SC_SRC)
  assert.ok(m)
  const scs = getShortcuts(m.root)
  assert.equal(scs.length, 1)
  const sc = scs[0]
  assert.equal(sc.index, 1)
  assert.equal(sc.name, 'fra_sc_next')
  assert.equal(sc.target, 'fra_second')
  assert.equal(sc.scrollWheelFactorText, '0.75')
  assert.equal(sc.hasTrigger, true)
  assert.deepEqual(getShortcutTrigger(sc.entry), [{ key: 'has_war', args: ['yes'], children: [] }])
  // 无 shortcut 的文件返回空
  const plain = loadFocusTree(SRC)
  assert.ok(plain)
  assert.deepEqual(getShortcuts(plain.root), [])
})

test('快捷路径：增删改无损往返', () => {
  const m = loadFocusTree(SC_SRC)
  assert.ok(m)
  const before = saveFocusTree(m)
  // 新增（name/target 带引号）
  addShortcut(m, 'fra_sc_back', 'fra_start')
  const added = saveFocusTree(m)
  assert.ok(added.includes('\tshortcut = {\n\t\tname = "fra_sc_back"\n\t\ttarget = "fra_start"\n\t}\n'))
  // 既有内容不受影响
  assert.ok(added.includes('\t\tname = fra_inlay\n'))
  assert.ok(added.includes('\t\tx = 1\n\t\ty = 0\n'))
  // 改字段：name/target/缩放系数
  const scs = getShortcuts(m.root)
  assert.equal(scs.length, 2)
  setShortcutName(scs[1].entry, 'fra_sc_first')
  setShortcutTarget(scs[1].entry, 'fra_second')
  setShortcutScrollFactor(scs[1].entry, 1.5)
  const edited = saveFocusTree(m)
  assert.ok(edited.includes('\t\tname = "fra_sc_first"'))
  assert.ok(edited.includes('\t\ttarget = "fra_second"'))
  assert.ok(edited.includes('\t\tscroll_wheel_factor = 1.5'))
  // 置 null 删除字段
  setShortcutScrollFactor(scs[1].entry, null)
  const noFactor = saveFocusTree(m)
  assert.ok(!noFactor.includes('scroll_wheel_factor = 1.5'))
  // 第一个快捷路径未被动过
  assert.ok(noFactor.includes('\t\tname = fra_sc_next\n'))
  // 删除后字节完全还原
  removeShortcut(m.root, scs[1].index)
  assert.equal(saveFocusTree(m), before)
})

test('快捷路径：trigger 空删/重写', () => {
  const m = loadFocusTree(SC_SRC)
  assert.ok(m)
  const sc = getShortcuts(m.root)[0]
  assert.ok(sc)
  // 删除：整个 trigger 条目消失
  setShortcutTrigger(sc.entry, [])
  const noTrigger = saveFocusTree(m)
  assert.ok(!noTrigger.includes('trigger'))
  assert.ok(noTrigger.includes('\t\ttarget = fra_second\n'))
  // 重新创建：规范多行块
  setShortcutTrigger(sc.entry, [
    { key: 'has_war', args: ['yes'], children: [] },
    { key: 'is_major', args: ['yes'], children: [] }
  ])
  const out = saveFocusTree(m)
  assert.ok(out.includes('\t\ttrigger = {\n\t\t\thas_war = yes\n\t\t\tis_major = yes\n\t\t}'))
  // 序列化往返无损
  const parsedOut = parseFile(out, 'txt').file
  assert.ok(parsedOut)
  assert.equal(serialize(parsedOut), out)
})
