import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  loadTraits,
  saveTraits,
  buildTraits,
  setTraitId,
  setTraitRandom,
  getTraitRows,
  setTraitRow,
  renameTraitRow,
  getTraitCondBlock,
  setTraitCondBlock,
  addTrait,
  deleteTrait,
  suggestTraitId,
  extractTraitIds,
  createTraitsFile
} from './traits.ts'
import { parseFile, serialize } from './clausewitz.ts'

/** 用户模组 paris_commune 的真实特质文件（common/country_leader/fra_traits.txt，tab 缩进） */
const REAL = `leader_traits = {
\t# 马赛尔·加香 基础特质：公社元老
\t# 稳定度+15% / 每周共产主义支持度+1%（每日+0.14）/ 党派支持对稳定度修正+20%
\tFRA_marcel_cachin_trait = {
\t\trandom = no
\t\tstability_factor = 0.15
\t\tcommunism_drift = 0.14
\t\tparty_popularity_stability_factor = 0.2
\t\tai_will_do = {
\t\t\tfactor = 0
\t\t}
\t}

\t# 追加特质：西欧红色灯塔（FRA_the_red_beacon_of_Western_Europe 完成后追加）
\t# 每周战争支持度+2% / 陆军核心领土防御+10%
\tFRA_marcel_cachin_beacon_trait = {
\t\trandom = no
\t\twar_support_weekly = 0.02
\t\tarmy_core_defence_factor = 0.1
\t\tai_will_do = {
\t\t\tfactor = 0
\t\t}
\t}

\t# 法兰西革命委员会（FRA_consolidate_power 上台的过渡领导人）
\t# 稳定度+10%
\tFRA_revolutionary_committee_trait = {
\t\trandom = no
\t\tstability_factor = 0.1
\t\tai_will_do = {
\t\t\tfactor = 0
\t\t}
\t}

\t# 莫里斯·多列士 顾问特质
\t# 政治点数+10% / 每日政治点数+0.3 / 科研速度+5% / 稳定度+10%
\tFRA_maurice_thorez_trait = {
\t\trandom = no
\t\tpolitical_power_factor = 0.1
\t\tpolitical_power_gain = 0.3
\t\tresearch_speed_factor = 0.05
\t\tstability_factor = 0.1
\t\tai_will_do = {
\t\t\tfactor = 0
\t\t}
\t}
}
`

test('特质文件：解析与序列化往返逐字节一致', () => {
  const parsed = parseFile(REAL, 'txt').file
  assert.ok(parsed)
  assert.equal(serialize(parsed), REAL)
})

test('loadTraits 读出 4 个特质', () => {
  const model = loadTraits(REAL)
  assert.ok(model)
  assert.deepEqual(
    model.traits.map((x) => x.id),
    ['FRA_marcel_cachin_trait', 'FRA_marcel_cachin_beacon_trait', 'FRA_revolutionary_committee_trait', 'FRA_maurice_thorez_trait']
  )
  assert.equal(model.traits[0].random, 'no')
  assert.equal(model.traits[0].hasAiWillDo, true)
})

test('getTraitRows 排除 random 与 ai_will_do，保持文件顺序', () => {
  const model = loadTraits(REAL)
  assert.ok(model)
  const rows = getTraitRows(model.traits[0].entry)
  assert.deepEqual(
    rows.map((r) => r.key),
    ['stability_factor', 'communism_drift', 'party_popularity_stability_factor']
  )
  assert.equal(rows[0].text, '0.15')
})

test('改修饰符值与键名：往返字节还原', () => {
  const model = loadTraits(REAL)
  assert.ok(model)
  const t = model.traits[0].entry
  setTraitRow(t, 'stability_factor', '0.2')
  assert.ok(saveTraits(model).includes('stability_factor = 0.2'))
  setTraitRow(t, 'stability_factor', '0.15')
  renameTraitRow(t, 'communism_drift', 'communism_drift_renamed')
  assert.ok(saveTraits(model).includes('communism_drift_renamed = 0.14'))
  renameTraitRow(t, 'communism_drift_renamed', 'communism_drift')
  assert.equal(saveTraits(model), REAL)
})

test('增删修饰符行：新行换行符沿用文件自身', () => {
  const model = loadTraits(REAL)
  assert.ok(model)
  const t = model.traits[1].entry
  setTraitRow(t, 'build_speed_factor', '0.05')
  let out = saveTraits(model)
  assert.ok(out.includes('build_speed_factor = 0.05'))
  setTraitRow(t, 'build_speed_factor', null)
  out = saveTraits(model)
  assert.ok(!out.includes('build_speed_factor'))
  assert.equal(out, REAL)
})

test('random 删除与原地恢复', () => {
  const model = loadTraits(REAL)
  assert.ok(model)
  const t = model.traits[0].entry
  setTraitRandom(t, null)
  assert.equal(saveTraits(model).split('random =').length - 1, 3, '只剩其余三个特质的 random')
  setTraitRandom(t, 'no')
  assert.equal(saveTraits(model), REAL)
})

test('ai_will_do 条件块读取与整块替换', () => {
  const model = loadTraits(REAL)
  assert.ok(model)
  const nodes = getTraitCondBlock(model.traits[0].entry, 'ai_will_do')
  assert.ok(nodes)
  assert.equal(nodes.length, 1)
  setTraitCondBlock(model.traits[0].entry, 'ai_will_do', nodes)
  assert.equal(saveTraits(model), REAL)
})

test('新增/删除特质与 suggestTraitId', () => {
  const model = loadTraits(REAL)
  assert.ok(model)
  assert.equal(suggestTraitId(model, 'FRA'), 'FRA_trait_1')
  const t = addTrait(model, 'FRA_trait_1')
  assert.ok(t)
  const out = saveTraits(model)
  assert.ok(out.includes('FRA_trait_1 = {'))
  assert.ok(out.includes('random = no'))
  deleteTrait(model, 'FRA_trait_1')
  assert.equal(saveTraits(model), REAL)
})

test('改特质 id', () => {
  const model = loadTraits(REAL)
  assert.ok(model)
  setTraitId(model.traits[0].entry, 'FRA_cachin_trait')
  assert.ok(saveTraits(model).includes('FRA_cachin_trait = {'))
  setTraitId(model.traits[0].entry, 'FRA_marcel_cachin_trait')
  assert.equal(saveTraits(model), REAL)
})

test('extractTraitIds 与 createTraitsFile 模板往返', () => {
  assert.deepEqual(extractTraitIds(REAL), [
    'FRA_marcel_cachin_trait',
    'FRA_marcel_cachin_beacon_trait',
    'FRA_revolutionary_committee_trait',
    'FRA_maurice_thorez_trait'
  ])
  const text = createTraitsFile('paris_commune', '\n')
  const parsed = parseFile(text, 'txt').file
  assert.ok(parsed)
  assert.equal(serialize(parsed), text)
  const model = loadTraits(text)
  assert.ok(model)
  assert.deepEqual(model.traits.map((x) => x.id), ['paris_commune_leader_trait'])
  assert.deepEqual(getTraitRows(model.traits[0].entry).map((r) => r.key), ['stability_factor'])
})

test('buildTraits 每次调用重新读取（模型修改后拿到最新状态）', () => {
  const { file } = parseFile(REAL, 'txt')
  assert.ok(file)
  const first = buildTraits(file)
  assert.equal(first.length, 4)
  addTrait({ file, traits: first, errors: [] }, 'FRA_x')
  const second = buildTraits(file)
  assert.equal(second.length, 5)
})
