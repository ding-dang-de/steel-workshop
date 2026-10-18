import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  loadDecisions,
  saveDecisions,
  buildDecisions,
  setDecisionId,
  setDecisionIcon,
  setDecisionCost,
  setDecisionDays,
  setDecisionFlag,
  getDecisionCondBlock,
  setDecisionCondBlock,
  addCategory,
  deleteCategory,
  addDecision,
  deleteDecision,
  hasDecision,
  suggestDecisionId,
  moveDecision,
  extractDecisionIds,
  createDecisionsFile
} from './decisions.ts'

/** 用户模组 paris_commune 的真实决议文件（common/decisions/FRA_diplomatic.txt，逐字节） */
const REAL = `# ===== 外交线决议：低地国家入阵营 + 整合阵营 =====

FRA_low_countries_category = {

	FRA_pull_belgium = {
		icon = generic_decision
		visible = {
			has_completed_focus = FRA_guard_against_German_fascism
		}
		available = {
			BEL = { exists = yes }
			NOT = { BEL = { is_in_faction_with = FRA } }
		}
		fire_only_once = yes
		cost = 50
		complete_effect = {
			BEL = { add_to_faction = FRA }
		}
		ai_will_do = {
			factor = 1
		}
	}

	FRA_pull_netherlands = {
		icon = generic_decision
		visible = {
			has_completed_focus = FRA_guard_against_German_fascism
		}
		available = {
			HOL = { exists = yes }
			NOT = { HOL = { is_in_faction_with = FRA } }
		}
		fire_only_once = yes
		cost = 50
		complete_effect = {
			HOL = { add_to_faction = FRA }
		}
		ai_will_do = {
			factor = 1
		}
	}

	FRA_pull_luxembourg = {
		icon = generic_decision
		visible = {
			has_completed_focus = FRA_guard_against_German_fascism
		}
		available = {
			LUX = { exists = yes }
			NOT = { LUX = { is_in_faction_with = FRA } }
		}
		fire_only_once = yes
		cost = 50
		complete_effect = {
			LUX = { add_to_faction = FRA }
		}
		ai_will_do = {
			factor = 1
		}
	}
}

FRA_integrate_faction_category = {

	FRA_integrate_western_europe = {
		icon = generic_decision
		visible = {
			has_completed_focus = FRA_integrated_development
		}
		available = {
			any_country = {
				is_in_faction_with = FRA
				NOT = { tag = FRA }
			}
		}
		fire_only_once = yes
		cost = 100
		complete_effect = {
			every_country = {
				limit = {
					is_in_faction_with = FRA
					NOT = { tag = FRA }
				}
				every_core_state = {
					add_core_of = FRA
				}
				FRA = {
					annex_country = {
						target = PREV
						transfer_troops = yes
					}
				}
			}
			set_cosmetic_tag = FRA_WESTERN_EUROPE
		}
		ai_will_do = {
			factor = 1
		}
	}
}
`

test('解析：真实决议文件——分类、决议与字段', () => {
  const m = loadDecisions(REAL)
  assert.ok(m)
  assert.equal(m.errors.length, 0)
  assert.deepEqual(m.categories, ['FRA_low_countries_category', 'FRA_integrate_faction_category'])
  assert.deepEqual(
    m.decisions.map((d) => d.id),
    ['FRA_pull_belgium', 'FRA_pull_netherlands', 'FRA_pull_luxembourg', 'FRA_integrate_western_europe']
  )
  const bel = m.decisions[0]
  assert.equal(bel.category, 'FRA_low_countries_category')
  assert.equal(bel.icon, 'generic_decision')
  assert.equal(bel.cost, '50')
  assert.equal(bel.daysRemove, '')
  assert.equal(bel.daysReEnable, '')
  assert.equal(bel.fireOnlyOnce, true)
  assert.equal(bel.isTargeted, false)
  assert.equal(bel.hasVisible, true)
  assert.equal(bel.hasAvailable, true)
  assert.equal(bel.hasCompleteEffect, true)
  assert.equal(bel.hasAiWillDo, true)
  assert.equal(bel.hasRemoveEffect, false)
  assert.equal(bel.hasModifier, false)
  assert.equal(bel.hasTargetedModifier, false)
  const integ = m.decisions[3]
  assert.equal(integ.category, 'FRA_integrate_faction_category')
  assert.equal(integ.cost, '100')
  assert.equal(integ.hasAvailable, true)
})

test('无损往返：解析后重新序列化逐字节一致', () => {
  const m = loadDecisions(REAL)
  assert.ok(m)
  assert.equal(saveDecisions(m), REAL)
})

test('修改图标：只重写那一行，其余字节原样', () => {
  const m = loadDecisions(REAL)
  assert.ok(m)
  const bel = buildDecisions(m.file).decisions.find((x) => x.id === 'FRA_pull_belgium')
  assert.ok(bel)
  setDecisionIcon(bel.entry, 'GFX_decision_test')
  const out = saveDecisions(m)
  const a = REAL.split(/\r?\n/)
  const b = out.split(/\r?\n/)
  const changed = b.map((l, i) => (l !== a[i] ? i + 1 : 0)).filter(Boolean)
  assert.deepEqual(changed, [6]) // 只有 icon 行变化
  setDecisionIcon(bel.entry, 'generic_decision')
  assert.equal(saveDecisions(m), REAL) // 还原后逐字节一致
})

test('开关标志：打开写 yes，关闭删条目（内存模型立刻更新）', () => {
  const m = loadDecisions(REAL)
  assert.ok(m)
  const bel = buildDecisions(m.file).decisions.find((x) => x.id === 'FRA_pull_belgium')
  assert.ok(bel)
  setDecisionFlag(bel.entry, 'targeted', true)
  assert.ok(saveDecisions(m).includes('targeted = yes'))
  setDecisionFlag(bel.entry, 'targeted', false)
  // 删除后内存模型立刻不可见（findEntry 跳过已删除条目，编辑器界面不能停留在旧状态）
  assert.equal(buildDecisions(m.file).decisions.find((x) => x.id === 'FRA_pull_belgium')?.isTargeted, false)
  assert.equal(saveDecisions(m), REAL) // 全文还原
  setDecisionFlag(bel.entry, 'fire_only_once', false)
  assert.equal(buildDecisions(m.file).decisions.find((x) => x.id === 'FRA_pull_belgium')?.fireOnlyOnce, false)
  assert.equal(saveDecisions(m).split('fire_only_once = yes').length - 1, 3) // 只剩其余三个决议的开关
  setDecisionFlag(bel.entry, 'fire_only_once', true)
  assert.equal(saveDecisions(m), REAL)
})

test('消耗与天数：cost / days_remove / days_re_enable 标量修改', () => {
  const m = loadDecisions(REAL)
  assert.ok(m)
  const bel = buildDecisions(m.file).decisions.find((x) => x.id === 'FRA_pull_belgium')
  assert.ok(bel)
  setDecisionCost(bel.entry, '75')
  assert.ok(saveDecisions(m).includes('cost = 75'))
  setDecisionCost(bel.entry, '50')
  assert.equal(saveDecisions(m), REAL)
  setDecisionDays(bel.entry, 'days_remove', '90')
  assert.ok(saveDecisions(m).includes('days_remove = 90'))
  setDecisionDays(bel.entry, 'days_remove', '')
  assert.equal(saveDecisions(m), REAL) // 空值删除条目
})

test('条件块：visible 整块替换，其余决议完全未动', () => {
  const m = loadDecisions(REAL)
  assert.ok(m)
  const bel = buildDecisions(m.file).decisions.find((x) => x.id === 'FRA_pull_belgium')
  assert.ok(bel)
  const vis = getDecisionCondBlock(bel.entry, 'visible')
  assert.deepEqual(vis, [{ key: 'has_completed_focus', args: ['FRA_guard_against_German_fascism'], children: [] }])
  // 写入相同内容 → 规范化多行与原写法一致 → 逐字节一致
  setDecisionCondBlock(bel.entry, 'visible', [
    { key: 'has_completed_focus', args: ['FRA_guard_against_German_fascism'], children: [] }
  ])
  assert.equal(saveDecisions(m), REAL)
  // 换成新条件
  setDecisionCondBlock(bel.entry, 'visible', [
    { key: 'AND', args: [], children: [
      { key: 'has_completed_focus', args: ['FRA_guard_against_German_fascism'], children: [] },
      { key: 'has_war', args: ['yes'], children: [] }
    ] }
  ])
  const out = saveDecisions(m)
  assert.ok(out.includes('AND = {'))
  assert.ok(out.includes('has_war = yes'))
  // 比利时决议的 visible 已换成 AND；荷兰决议的可见条件原样未动
  const m2 = loadDecisions(out)
  assert.ok(m2)
  const bel2 = m2.decisions.find((x) => x.id === 'FRA_pull_belgium')
  assert.ok(bel2)
  assert.deepEqual(getDecisionCondBlock(bel2.entry, 'visible'), [
    { key: 'AND', args: [], children: [
      { key: 'has_completed_focus', args: ['FRA_guard_against_German_fascism'], children: [] },
      { key: 'has_war', args: ['yes'], children: [] }
    ] }
  ])
  const hol2 = m2.decisions.find((x) => x.id === 'FRA_pull_netherlands')
  assert.ok(hol2)
  assert.deepEqual(getDecisionCondBlock(hol2.entry, 'visible'), [
    { key: 'has_completed_focus', args: ['FRA_guard_against_German_fascism'], children: [] }
  ])
  // 其它决议与分类不受影响
  assert.ok(out.includes('HOL = { exists = yes }'))
  assert.ok(out.includes('cost = 100'))
  // 空节点删除块
  setDecisionCondBlock(bel.entry, 'visible', [])
  assert.equal(buildDecisions(m.file).decisions.find((x) => x.id === 'FRA_pull_belgium')?.hasVisible, false)
})

test('决议增删与 id 修改', () => {
  const m = loadDecisions(REAL)
  assert.ok(m)
  const entry = addDecision(m, 'FRA_low_countries_category', 'FRA_test_decision')
  assert.equal(buildDecisions(m.file).decisions.length, 5)
  assert.equal(hasDecision(m, 'FRA_test_decision'), true)
  setDecisionId(entry, 'FRA_renamed_decision')
  assert.equal(hasDecision(m, 'FRA_test_decision'), false)
  assert.equal(hasDecision(m, 'FRA_renamed_decision'), true)
  const fresh = buildDecisions(m.file).decisions.find((x) => x.id === 'FRA_renamed_decision')
  assert.ok(fresh)
  assert.equal(fresh.icon, 'generic_decision')
  assert.equal(fresh.cost, '50')
  assert.equal(fresh.fireOnlyOnce, true)
  assert.equal(fresh.hasAiWillDo, true)
  assert.equal(fresh.category, 'FRA_low_countries_category')
  deleteDecision(m, 'FRA_renamed_decision')
  assert.equal(buildDecisions(m.file).decisions.length, 4)
  assert.equal(saveDecisions(m), REAL) // 增删后字节完全还原
})

test('suggestDecisionId：大写命名空间 + 递增序号，避开已占用', () => {
  const m = loadDecisions(REAL)
  assert.ok(m)
  assert.equal(suggestDecisionId(m, 'paris_commune'), 'PARIS_COMMUNE_decision_1')
  addDecision(m, 'FRA_low_countries_category', 'PARIS_COMMUNE_decision_1')
  assert.equal(suggestDecisionId(m, 'paris_commune'), 'PARIS_COMMUNE_decision_2')
})

test('分类：新建/删除空分类（字节还原），非空分类拒绝删除', () => {
  const m = loadDecisions(REAL)
  assert.ok(m)
  addCategory(m, 'FRA_empty_category')
  assert.deepEqual(buildDecisions(m.file).categories, [
    'FRA_low_countries_category',
    'FRA_integrate_faction_category',
    'FRA_empty_category'
  ])
  assert.equal(deleteCategory(m, 'FRA_low_countries_category'), false) // 非空拒绝
  assert.equal(deleteCategory(m, 'FRA_empty_category'), true)
  assert.equal(saveDecisions(m), REAL) // 新建再删除后字节完全还原
})

test('moveDecision：原字节复制到新分类，原分类移除', () => {
  const m = loadDecisions(REAL)
  assert.ok(m)
  addCategory(m, 'FRA_new_category')
  moveDecision(m, 'FRA_pull_belgium', 'FRA_new_category')
  const { decisions, categories } = buildDecisions(m.file)
  assert.equal(categories.length, 3)
  const bel = decisions.find((x) => x.id === 'FRA_pull_belgium')
  assert.ok(bel)
  assert.equal(bel.category, 'FRA_new_category')
  assert.equal(decisions.filter((x) => x.category === 'FRA_low_countries_category').length, 2)
  const out = saveDecisions(m)
  // 决议本体按原字节完整保留（含缩进、内部结构）
  const block = 'FRA_pull_belgium = {\n\t\ticon = generic_decision\n\t\tvisible = {\n\t\t\thas_completed_focus = FRA_guard_against_German_fascism\n\t\t}\n\t\tavailable = {\n\t\t\tBEL = { exists = yes }\n\t\t\tNOT = { BEL = { is_in_faction_with = FRA } }\n\t\t}\n\t\tfire_only_once = yes\n\t\tcost = 50\n\t\tcomplete_effect = {\n\t\t\tBEL = { add_to_faction = FRA }\n\t\t}\n\t\tai_will_do = {\n\t\t\tfactor = 1\n\t\t}\n\t}'
  assert.equal(out.split(block).length - 1, 1) // 全文只出现一次
  assert.ok(out.includes('FRA_new_category = {'))
  // 撤销（历史快照重新解析）后与移动前逐字节一致
  const before = loadDecisions(REAL)
  assert.ok(before)
  assert.equal(saveDecisions(before), REAL)
})

test('extractDecisionIds：提取全部决议 id', () => {
  assert.deepEqual(extractDecisionIds(REAL), [
    'FRA_pull_belgium',
    'FRA_pull_netherlands',
    'FRA_pull_luxembourg',
    'FRA_integrate_western_europe'
  ])
})

test('createDecisionsFile：模板可解析、结构正确、逐字节往返', () => {
  const text = createDecisionsFile('paris_commune')
  assert.equal(
    text,
    `# ===== PARIS_COMMUNE 决议 =====

PARIS_COMMUNE_decision_category = {

	PARIS_COMMUNE_example_decision = {
		icon = generic_decision
		cost = 50
		fire_only_once = yes
		visible = { }
		complete_effect = { }
		ai_will_do = {
			factor = 1
		}
	}
}
`
  )
  const m = loadDecisions(text)
  assert.ok(m)
  assert.equal(m.errors.length, 0)
  assert.deepEqual(m.categories, ['PARIS_COMMUNE_decision_category'])
  assert.equal(m.decisions.length, 1)
  const d = m.decisions[0]
  assert.equal(d.id, 'PARIS_COMMUNE_example_decision')
  assert.equal(d.cost, '50')
  assert.equal(d.fireOnlyOnce, true)
  assert.equal(d.hasVisible, true)
  assert.equal(d.hasCompleteEffect, true)
  assert.equal(d.hasAiWillDo, true)
  assert.equal(saveDecisions(m), text) // 模板本身无损往返
})
