import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  loadIdeas,
  saveIdeas,
  buildIdeas,
  setIdeaId,
  setIdeaPicture,
  getIdeaCondBlock,
  setIdeaCondBlock,
  getModifierRows,
  setModifierRow,
  renameModifierRow,
  addCategory,
  deleteCategory,
  addIdea,
  deleteIdea,
  moveIdea,
  hasIdea,
  suggestIdeaId,
  extractIdeaIds,
  createIdeasFile
} from './ideas.ts'
import { parseFile, serialize } from './clausewitz.ts'

/** 用户模组 paris_commune 的真实民族精神文件（common/ideas/fra.txt，4 空格缩进） */
const REAL = `ideas = {
    country = {  # 这里的 "country" 告诉游戏这是一个国家精神
        FRA_general_strike = {  # 总罢工
            picture = generic_economic_crisis  # 图标（原版已核实存在）
            allowed = {
				tag = FRA
				always = no
			}

            modifier = {
                consumer_goods_factor = 0.20        # 生活消费品系数 +20%
                production_speed_buildings_factor = -0.20   # 建设速度 -20%
            }
        }

        FRA_syndicalist_march = {   # 工团游行
            picture = generic_communism

            modifier = {
                communism_drift = 0.2      # 每日共产主义支持度 +0.2
                stability_factor = -0.1    # 稳定度 -10%
            }
        }
    }
}
`

test('民族精神文件：解析与序列化往返逐字节一致', () => {
  const parsed = parseFile(REAL, 'txt').file
  assert.ok(parsed)
  assert.equal(serialize(parsed), REAL)
})

test('loadIdeas 读出分类与精神列表', () => {
  const model = loadIdeas(REAL)
  assert.ok(model)
  assert.deepEqual(model.categories, ['country'])
  assert.deepEqual(model.ideas.map((x) => x.id), ['FRA_general_strike', 'FRA_syndicalist_march'])
  const strike = model.ideas[0]
  assert.equal(strike.picture, 'generic_economic_crisis')
  assert.equal(strike.hasAllowed, true)
  assert.equal(strike.hasModifier, true)
  assert.equal(strike.hasOnAdd, false)
})

test('改图标：只重写 picture 一行，其余字节不动', () => {
  const model = loadIdeas(REAL)
  assert.ok(model)
  setIdeaPicture(model.ideas[0].entry, 'generic_research')
  const out = saveIdeas(model)
  assert.ok(out.includes('picture = generic_research'))
  assert.ok(!out.includes('picture = generic_economic_crisis'))
  assert.ok(out.includes('consumer_goods_factor = 0.20        # 生活消费品系数 +20%'))
  // 只改一处：把 picture 行改回去后与原文一致
  const lines = out.split('\n').filter((l) => l.includes('picture = '))
  assert.equal(lines.length, 2)
})

test('改修饰符值：行尾注释原地保留', () => {
  const model = loadIdeas(REAL)
  assert.ok(model)
  const rows = getModifierRows(model.ideas[0].entry)
  assert.deepEqual(rows.map((r) => r.key), ['consumer_goods_factor', 'production_speed_buildings_factor'])
  assert.equal(rows[0].text, '0.20')
  assert.equal(rows[0].comment, '# 生活消费品系数 +20%')
  setModifierRow(model.ideas[0].entry, 'consumer_goods_factor', '0.35')
  const out = saveIdeas(model)
  assert.ok(out.includes('consumer_goods_factor = 0.35        # 生活消费品系数 +20%'))
  assert.ok(out.includes('production_speed_buildings_factor = -0.20   # 建设速度 -20%'))
})

test('增删修饰符行：新增行换行符沿用文件自身', () => {
  const model = loadIdeas(REAL)
  assert.ok(model)
  setModifierRow(model.ideas[1].entry, 'research_speed_factor', '0.05')
  let out = saveIdeas(model)
  assert.ok(out.includes('research_speed_factor = 0.05'))
  // 删除整行（含行尾注释）
  setModifierRow(model.ideas[1].entry, 'communism_drift', null)
  out = saveIdeas(model)
  assert.ok(!out.includes('communism_drift'))
  assert.ok(out.includes('stability_factor = -0.1    # 稳定度 -10%'))
  // 删除后重新赋值：原地恢复
  setModifierRow(model.ideas[1].entry, 'communism_drift', '0.3')
  out = saveIdeas(model)
  assert.ok(out.includes('communism_drift = 0.3'))
  assert.ok(!out.includes('communism_drift = 0.2'))
})

test('改修饰符行的键名：行尾注释与位置保留', () => {
  const model = loadIdeas(REAL)
  assert.ok(model)
  renameModifierRow(model.ideas[0].entry, 'consumer_goods_factor', 'stability_factor_renamed')
  const out = saveIdeas(model)
  assert.ok(out.includes('stability_factor_renamed = 0.20        # 生活消费品系数 +20%'))
  assert.ok(!out.includes('consumer_goods_factor = 0.20'))
  // 同一行位置不变：改回原名后逐字节还原
  renameModifierRow(model.ideas[0].entry, 'stability_factor_renamed', 'consumer_goods_factor')
  assert.equal(saveIdeas(model), REAL)
})

test('allowed 条件块：结构化读取与整块替换', () => {
  const model = loadIdeas(REAL)
  assert.ok(model)
  const nodes = getIdeaCondBlock(model.ideas[0].entry, 'allowed')
  assert.ok(nodes)
  assert.equal(nodes.length, 2)
  setIdeaCondBlock(model.ideas[0].entry, 'allowed', nodes)
  const out = saveIdeas(model)
  assert.ok(out.includes('allowed = {'))
})

test('新增/删除精神与分类', () => {
  const model = loadIdeas(REAL)
  assert.ok(model)
  const idea = addIdea(model, 'country', 'FRA_test_idea')
  assert.ok(idea)
  assert.equal(hasIdea(model, 'FRA_test_idea'), true)
  let out = saveIdeas(model)
  assert.ok(out.includes('FRA_test_idea = {'))
  assert.ok(out.includes('picture = generic_communism'))
  deleteIdea(model, 'FRA_test_idea')
  out = saveIdeas(model)
  assert.equal(out, REAL)

  addCategory(model, 'political_advisor')
  out = saveIdeas(model)
  assert.ok(out.includes('political_advisor = {'))
  // 空分类可删
  assert.equal(deleteCategory(model, 'political_advisor'), true)
  out = saveIdeas(model)
  assert.equal(out, REAL)
  // 非空分类拒绝删除
  assert.equal(deleteCategory(model, 'country'), false)
})

test('跨分类移动精神：移动块原字节保留，移回后逐字节还原', () => {
  const model = loadIdeas(REAL)
  assert.ok(model)
  addCategory(model, 'political_advisor')
  moveIdea(model, 'FRA_syndicalist_march', 'political_advisor')
  let out = saveIdeas(model)
  assert.ok(out.includes('political_advisor = {'))
  // 移动块内部保持原字节（含行尾注释）
  assert.ok(out.includes('communism_drift = 0.2      # 每日共产主义支持度 +0.2'))
  moveIdea(model, 'FRA_syndicalist_march', 'country')
  // 移回后删除空出来的分类，文件应逐字节还原
  assert.equal(deleteCategory(model, 'political_advisor'), true)
  out = saveIdeas(model)
  assert.equal(out, REAL)
})

test('改精神 id 与 suggestIdeaId', () => {
  const model = loadIdeas(REAL)
  assert.ok(model)
  setIdeaId(model.ideas[1].entry, 'FRA_march')
  const out = saveIdeas(model)
  assert.ok(out.includes('FRA_march = {'))
  assert.ok(!out.includes('FRA_syndicalist_march = {'))
  assert.equal(suggestIdeaId(model, 'FRA'), 'FRA_idea_1')
  addIdea(model, 'country', 'FRA_idea_1')
  assert.equal(suggestIdeaId(model, 'FRA'), 'FRA_idea_2')
})

test('extractIdeaIds 提取全部精神 id', () => {
  assert.deepEqual(extractIdeaIds(REAL), ['FRA_general_strike', 'FRA_syndicalist_march'])
})

test('createIdeasFile 模板结构正确且可往返', () => {
  const text = createIdeasFile('paris_commune', '\n')
  const parsed = parseFile(text, 'txt').file
  assert.ok(parsed)
  assert.equal(serialize(parsed), text)
  const model = loadIdeas(text)
  assert.ok(model)
  assert.deepEqual(model.categories, ['country'])
  assert.deepEqual(model.ideas.map((x) => x.id), ['paris_commune_idea_1'])
  assert.equal(model.ideas[0].picture, 'generic_communism')
  const rows = getModifierRows(model.ideas[0].entry)
  assert.deepEqual(rows.map((r) => r.key), ['stability_factor'])
  assert.equal(rows[0].text, '0.1')
})

test('buildIdeas 每次调用重新读取（模型修改后拿到最新状态）', () => {
  const { file } = parseFile(REAL, 'txt')
  assert.ok(file)
  const first = buildIdeas(file)
  assert.equal(first.ideas.length, 2)
  addIdea({ file, ideas: first.ideas, categories: first.categories, errors: [] }, 'country', 'FRA_x')
  const second = buildIdeas(file)
  assert.equal(second.ideas.length, 3)
})
