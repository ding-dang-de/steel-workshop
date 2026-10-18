import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  loadEvents,
  saveEvents,
  buildEvents,
  setEventTitle,
  setEventFlag,
  setEventType,
  addEvent,
  deleteEvent,
  hasEvent,
  suggestEventId,
  addOption,
  deleteOption,
  setOptionName,
  getOptionEffects,
  setOptionEffects,
  getEventCondBlock,
  setEventCondBlock,
  suggestGlobalEventId,
  createEventsFile,
  extractEventIds
} from './events.ts'

const SAMPLE = `add_namespace = france

# 日本要求印度支那
country_event = {
\tid = france.1
\ttitle = france.1.t
\tdesc = france.1.d
\tpicture = GFX_report_event_japan_army_mountainside

\tis_triggered_only = yes

\toption = { # 接受
\t\tname = france.1.a
\t\tai_chance = {
\t\t\tbase = 25
\t\t\tmodifier = {
\t\t\t\tfactor = 50
\t\t\t\thas_war = yes
\t\t\t}
\t\t}
\t\tadd_stability = 0.05
\t}
\toption = { # 拒绝
\t\tname = france.1.b
\t\ttrigger = {
\t\t\thas_war = no
\t\t}
\t}
}

# 有 MTTH 的事件
country_event = {
\tid = france.10
\tfire_only_once = yes
\ttrigger = {
\t\thas_war = yes
\t}
\tmean_time_to_happen = {
\t\tdays = 30
\t\tmodifier = {
\t\t\tfactor = 0.5
\t\t\thas_stability > 0.6
\t\t}
\t}
\timmediate = {
\t\tset_global_flag = test_flag
\t}
}

news_event = {
\tid = news.1
\tmajor = yes
\thidden = yes
}
`

test('解析：事件类型、字段、选项与命名空间', () => {
  const m = loadEvents(SAMPLE)
  assert.ok(m)
  assert.equal(m.namespace, 'france')
  assert.equal(m.events.length, 3)
  const [e1, e2, e3] = m.events
  assert.equal(e1.type, 'country_event')
  assert.equal(e1.id, 'france.1')
  assert.equal(e1.title, 'france.1.t')
  assert.equal(e1.desc, 'france.1.d')
  assert.equal(e1.picture, 'GFX_report_event_japan_army_mountainside')
  assert.equal(e1.isTriggeredOnly, true)
  assert.equal(e1.fireOnlyOnce, false)
  assert.equal(e1.options.length, 2)
  assert.equal(e1.options[0].name, 'france.1.a')
  assert.equal(e1.options[0].hasAiChance, true)
  assert.equal(e1.options[0].hasEffects, true)
  assert.equal(e1.options[1].hasTrigger, true)
  assert.equal(e1.options[1].hasEffects, false)
  assert.equal(e2.hasTrigger, true)
  assert.equal(e2.hasMtth, true)
  assert.equal(e2.hasImmediate, true)
  assert.equal(e2.fireOnlyOnce, true)
  assert.equal(e3.type, 'news_event')
  assert.equal(e3.major, true)
  assert.equal(e3.hidden, true)
  assert.equal(m.errors.length, 0)
})

test('无损往返：解析后重新序列化逐字节一致', () => {
  const m = loadEvents(SAMPLE)
  assert.ok(m)
  assert.equal(saveEvents(m), SAMPLE)
})

test('修改标量：只重写那一行，其余字节原样', () => {
  const m = loadEvents(SAMPLE)
  assert.ok(m)
  const e = buildEvents(m.file).events.find((x) => x.id === 'france.1')
  assert.ok(e)
  setEventTitle(e.entry, 'france.1.new_title')
  const out = saveEvents(m)
  const a = SAMPLE.split(/\r?\n/)
  const b = out.split(/\r?\n/)
  const changed = b.map((l, i) => (l !== a[i] ? i + 1 : 0)).filter(Boolean)
  assert.deepEqual(changed, [6]) // 只有 title 行变化
  assert.ok(out.includes('title = france.1.new_title'))
  assert.ok(!out.includes('title = france.1.t'))
})

test('开关标志：打开写 yes，关闭删条目', () => {
  const m = loadEvents(SAMPLE)
  assert.ok(m)
  const e = buildEvents(m.file).events.find((x) => x.id === 'france.1')
  assert.ok(e)
  setEventFlag(e.entry, 'fire_only_once', true)
  const withFlag = saveEvents(m)
  assert.ok(withFlag.includes('fire_only_once = yes'))
  setEventFlag(e.entry, 'fire_only_once', false)
  // 删除后内存模型立刻不可见（findEntry 跳过已删除条目，编辑器界面不能停留在旧状态）
  assert.equal(buildEvents(m.file).events.find((x) => x.id === 'france.1')?.fireOnlyOnce, false)
  const without = saveEvents(m)
  assert.equal(without, SAMPLE) // france.1 里的开关删除后全文还原（france.10 的 fire_only_once 不受影响）
})

test('开关标志：关闭再打开后行序原位恢复（位置不漂移）', () => {
  const m = loadEvents(SAMPLE)
  assert.ok(m)
  const e = buildEvents(m.file).events.find((x) => x.id === 'france.1')
  assert.ok(e)
  setEventFlag(e.entry, 'fire_only_once', true) // 原来没有 → 追加
  const with1 = saveEvents(m)
  assert.ok(with1.includes('\n\tfire_only_once = yes')) // 新行独立成行，不与上一行粘在一起
  setEventFlag(e.entry, 'fire_only_once', false) // 删除
  setEventFlag(e.entry, 'fire_only_once', true) // 重新打开 → 原位恢复而不是追加到块尾
  assert.equal(buildEvents(m.file).events.find((x) => x.id === 'france.1')?.fireOnlyOnce, true)
  assert.equal(saveEvents(m), with1) // 与首次打开时逐字节一致
})

test('事件增删与类型修改', () => {
  const m = loadEvents(SAMPLE)
  assert.ok(m)
  const entry = addEvent(m, 'news_event', 'france.99')
  assert.equal(buildEvents(m.file).events.length, 4)
  setEventType(entry, 'country_event')
  assert.equal(buildEvents(m.file).events.find((x) => x.id === 'france.99')?.type, 'country_event')
  assert.equal(hasEvent(m, 'france.99'), true)
  deleteEvent(m, 'france.99')
  assert.equal(buildEvents(m.file).events.length, 3)
  assert.equal(saveEvents(m), SAMPLE) // 增删后字节完全还原
})

test('suggestEventId：命名空间 + 递增序号，避开已占用', () => {
  const m = loadEvents(SAMPLE)
  assert.ok(m)
  const id = suggestEventId(m)
  assert.equal(id, 'france.2') // france.1 与 france.10 已占用，且 id 不按数字大小解析
  addEvent(m, 'country_event', id)
  assert.equal(suggestEventId(m), 'france.3')
})

test('选项：增删与改名，效果编辑保留保留键', () => {
  const m = loadEvents(SAMPLE)
  assert.ok(m)
  const e = buildEvents(m.file).events.find((x) => x.id === 'france.1')
  assert.ok(e)
  const opt = addOption(e.entry, 'france.1.c', '\n')
  assert.equal(buildEvents(m.file).events.find((x) => x.id === 'france.1')?.options.length, 3)
  setOptionName(opt, 'france.1.c_new')
  // 给新选项加效果：含嵌套块与标量
  setOptionEffects(opt, [{ key: 'add_stability', args: ['0.1'], children: [] }], '\n')
  const fx = getOptionEffects(opt)
  assert.deepEqual(fx, [{ key: 'add_stability', args: ['0.1'], children: [] }])
  // 效果编辑不动 name
  const cur = buildEvents(m.file).events.find((x) => x.id === 'france.1')
  assert.equal(cur?.options.find((o) => o.entry === opt)?.name, 'france.1.c_new')
  deleteOption(opt)
  assert.equal(buildEvents(m.file).events.find((x) => x.id === 'france.1')?.options.length, 2)
  assert.equal(saveEvents(m), SAMPLE) // 全部还原
})

test('选项效果编辑：保留 name/trigger/ai_chance，只重写效果', () => {
  const m = loadEvents(SAMPLE)
  assert.ok(m)
  const e = buildEvents(m.file).events.find((x) => x.id === 'france.1')
  assert.ok(e)
  const o0 = e.options[0]
  setOptionEffects(
    o0.entry,
    [
      { key: 'add_political_power', args: ['150'], children: [] },
      { key: 'if', args: [], children: [{ key: 'limit', args: [], children: [{ key: 'has_war', args: ['yes'], children: [] }] }, { key: 'add_stability', args: ['0.1'], children: [] }] }
    ],
    '\n'
  )
  const out = saveEvents(m)
  // 保留键还在
  assert.ok(out.includes('name = france.1.a'))
  assert.ok(out.includes('ai_chance = {'))
  assert.ok(out.includes('base = 25'))
  assert.ok(out.includes('has_war = yes'))
  // 旧效果被替换
  assert.ok(!out.includes('add_stability = 0.05'))
  assert.ok(out.includes('add_political_power = 150'))
  assert.ok(out.includes('if = {'))
  // 第二个选项与其它事件完全未动
  assert.ok(out.includes('name = france.1.b'))
  assert.ok(out.includes('id = france.10'))
})

test('事件条件块：trigger 整块替换，MTTH 可读', () => {
  const m = loadEvents(SAMPLE)
  assert.ok(m)
  const e = buildEvents(m.file).events.find((x) => x.id === 'france.10')
  assert.ok(e)
  const trig = getEventCondBlock(e.entry, 'trigger')
  assert.deepEqual(trig, [{ key: 'has_war', args: ['yes'], children: [] }])
  const mtth = getEventCondBlock(e.entry, 'mean_time_to_happen')
  assert.ok(mtth)
  assert.equal(mtth[0].key, 'days')
  assert.equal(mtth[0].args[0], '30')
  assert.equal(mtth[1].key, 'modifier')
  assert.equal(mtth[1].children[0].key, 'factor')
  // 替换 trigger 为复杂条件
  setEventCondBlock(e.entry, 'trigger', [
    { key: 'AND', args: [], children: [{ key: 'has_war', args: ['yes'], children: [] }, { key: 'is_major', args: ['yes'], children: [] }] }
  ])
  const out = saveEvents(m)
  assert.ok(out.includes('AND = {'))
  assert.ok(out.includes('is_major = yes'))
  assert.ok(!out.includes('trigger = {\n\t\thas_war = yes\n\t}'))
  // 空节点删除块（只删 france.10 的 trigger，选项里的 trigger 不动）
  setEventCondBlock(e.entry, 'trigger', [])
  const out2 = saveEvents(m)
  assert.equal(loadEvents(out2)?.events.find((x) => x.id === 'france.10')?.hasTrigger, false)
  assert.equal(loadEvents(out2)?.events.find((x) => x.id === 'france.1')?.options[1].hasTrigger, true)
  assert.ok(out2.includes('mean_time_to_happen'))
})

test('createEventsFile：模板可解析、结构正确', () => {
  const text = createEventsFile('france')
  const m = loadEvents(text)
  assert.ok(m)
  assert.equal(m.namespace, 'france')
  assert.equal(m.events.length, 1)
  const e = m.events[0]
  assert.equal(e.id, 'france.1')
  assert.equal(e.title, 'france.1.t')
  assert.equal(e.desc, 'france.1.d')
  assert.equal(e.isTriggeredOnly, true)
  assert.equal(e.options.length, 1)
  assert.equal(e.options[0].name, 'france.1.a')
  assert.equal(saveEvents(m), text) // 模板本身无损往返
})

test('extractEventIds：提取全部事件 id', () => {
  assert.deepEqual(extractEventIds(SAMPLE), ['france.1', 'france.10', 'news.1'])
})

// ---------- 全局事件 id 建议（国策联动用） ----------

test('suggestGlobalEventId：避开已有 id 递增', () => {
  assert.equal(suggestGlobalEventId([], 'france'), 'france.1')
  assert.equal(suggestGlobalEventId(['france.1'], 'france'), 'france.2')
  assert.equal(suggestGlobalEventId(['france.1', 'france.2', 'france.5'], 'france'), 'france.3')
  assert.equal(suggestGlobalEventId(['FRANCE.1'], 'france'), 'france.2') // 占用判定不区分大小写
  assert.equal(suggestGlobalEventId(['france.1'], '巴黎公社'), 'event.1') // 纯中文命名空间 → 兜底
  assert.equal(suggestGlobalEventId(['event.1'], ''), 'event.2') // 空命名空间 → 兜底且避占用
})
