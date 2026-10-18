/**
 * HOI4 条件/效果目录与结构化编辑模型
 *
 * - COND_CATALOG：常用效果（effect）与触发条件（trigger）的中文说明和参数规格，
 *   条目签名以游戏 1.19 原版文件的真实用法为准（已逐条核实）。
 * - CondNode：条件树模型（统一表示 标量参数 / 嵌套块 / 逻辑组合）。
 *   例：available = { has_war = yes AND = { is_major = yes } }
 *   → [ {key:'has_war', args:['yes']}, {key:'AND', children:[{key:'is_major', args:['yes']}]} ]
 * - parseCondBlock / renderCondNodes：与无损解析器互转。
 *   结构化保存会把整块重写为规范多行写法（只有被编辑的块会重写，其余字节不变）。
 */

import { parseFile, findEntry } from './clausewitz.ts'
import type { CwBlock, CwItem } from './clausewitz.ts'

// ---------- 目录 ----------

export type CondParamKind = 'string' | 'number' | 'bool' | 'enum' | 'tag' | 'focus' | 'idea' | 'char' | 'scope'

export interface CondParam {
  /** 参数名（块参数）或字段标签（标量参数） */
  name: string
  kind: CondParamKind
  /** enum 的候选值 */
  values?: string[]
  /** 块参数（key = { ... }）而非标量 */
  block?: boolean
  optional?: boolean
  hint?: string
}

export type CondCat =
  | 'logic'
  | 'politics'
  | 'diplomacy'
  | 'war'
  | 'economy'
  | 'military'
  | 'characters'
  | 'variables'
  | 'events'
  | 'map'

export interface CondSpec {
  key: string
  /** 中文说明 */
  zh: string
  cat: CondCat
  kind: 'effect' | 'trigger' | 'logic'
  /** 生效作用域说明 */
  scope?: string
  params?: CondParam[]
  example?: string
}

export const CAT_ZH: Record<CondCat, string> = {
  logic: '逻辑',
  politics: '政治',
  diplomacy: '外交',
  war: '战争与领土',
  economy: '经济与科研',
  military: '军事',
  characters: '人物',
  variables: '变量与标志',
  events: '事件与随机',
  map: '地图与州'
}

const GOV_VALUES = ['democratic', 'communism', 'fascism', 'neutrality', 'socialism']

export const COND_CATALOG: CondSpec[] = [
  // ---------- 逻辑 ----------
  { key: 'if', zh: '条件分支：满足 limit 时执行其内效果', cat: 'logic', kind: 'logic', scope: '任意', example: 'if = { limit = { has_war = yes } add_stability = 0.1 }' },
  { key: 'else_if', zh: '上面的 if 不满足、且满足本块 limit 时执行', cat: 'logic', kind: 'logic', scope: '任意' },
  { key: 'else', zh: '上面的分支都不满足时执行', cat: 'logic', kind: 'logic', scope: '任意' },
  { key: 'limit', zh: '条件限制（if / else_if 内的触发条件）', cat: 'logic', kind: 'logic', scope: '任意' },
  { key: 'AND', zh: '逻辑与：全部条件同时满足', cat: 'logic', kind: 'logic', scope: '任意' },
  { key: 'OR', zh: '逻辑或：任一条件满足即可', cat: 'logic', kind: 'logic', scope: '任意' },
  { key: 'NOT', zh: '逻辑非：其内条件不满足', cat: 'logic', kind: 'logic', scope: '任意' },
  { key: 'hidden_effect', zh: '隐藏效果：执行但不显示在提示框里', cat: 'logic', kind: 'effect', scope: '任意' },
  { key: 'hidden_trigger', zh: '隐藏条件：不显示在提示框里', cat: 'logic', kind: 'logic', scope: '任意' },
  { key: 'custom_trigger_tooltip', zh: '自定义条件提示（tooltip = 本地化键）', cat: 'logic', kind: 'logic', scope: '任意', params: [{ name: 'tooltip', kind: 'string', block: false, hint: '本地化键' }] },
  { key: 'custom_effect_tooltip', zh: '自定义效果提示', cat: 'logic', kind: 'effect', scope: '任意', params: [{ name: 'tooltip', kind: 'string', hint: '本地化键' }] },
  { key: 'tooltip', zh: '提示文本（只显示说明，无实际作用）', cat: 'logic', kind: 'effect', scope: '任意', params: [{ name: '本地化键', kind: 'string' }] },

  // ---------- 政治 ----------
  { key: 'add_political_power', zh: '增加政治点数', cat: 'politics', kind: 'effect', scope: '国家', params: [{ name: '数值', kind: 'number', hint: '负数表示扣除' }], example: 'add_political_power = 150' },
  { key: 'set_political_power', zh: '把政治点数设为某值', cat: 'politics', kind: 'effect', scope: '国家', params: [{ name: '数值', kind: 'number' }] },
  { key: 'add_stability', zh: '增加稳定度', cat: 'politics', kind: 'effect', scope: '国家', params: [{ name: '数值', kind: 'number', hint: '0~1，负数表示降低' }], example: 'add_stability = 0.1' },
  { key: 'set_stability', zh: '把稳定度设为某值', cat: 'politics', kind: 'effect', scope: '国家', params: [{ name: '数值', kind: 'number', hint: '0~1' }] },
  { key: 'add_war_support', zh: '增加战争支持度', cat: 'politics', kind: 'effect', scope: '国家', params: [{ name: '数值', kind: 'number', hint: '0~1' }] },
  { key: 'set_war_support', zh: '把战争支持度设为某值', cat: 'politics', kind: 'effect', scope: '国家', params: [{ name: '数值', kind: 'number', hint: '0~1' }] },
  { key: 'set_politics', zh: '修改政治体制（执政党/选举）', cat: 'politics', kind: 'effect', scope: '国家', params: [
    { name: 'ruling_party', kind: 'enum', values: GOV_VALUES, block: true },
    { name: 'elections_allowed', kind: 'bool', block: true, optional: true },
    { name: 'last_election', kind: 'string', block: true, optional: true, hint: '如 1936.1.1' }
  ], example: 'set_politics = { ruling_party = democratic }' },
  { key: 'set_country_leader_ideology', zh: '把现任国家领袖的意识形态设为某党', cat: 'politics', kind: 'effect', scope: '国家', params: [{ name: '意识形态', kind: 'enum', values: GOV_VALUES }] },
  { key: 'add_popularity', zh: '增加政党支持率', cat: 'politics', kind: 'effect', scope: '国家', params: [
    { name: 'popularity', kind: 'number', block: true },
    { name: 'party', kind: 'enum', values: GOV_VALUES, block: true, optional: true }
  ], example: 'add_popularity = { popularity = 10 party = democratic }' },
  { key: 'set_popularity', zh: '把政党支持率设为某值', cat: 'politics', kind: 'effect', scope: '国家', params: [
    { name: 'popularity', kind: 'number', block: true },
    { name: 'party', kind: 'enum', values: GOV_VALUES, block: true, optional: true }
  ] },
  { key: 'set_party_name', zh: '修改政党名称', cat: 'politics', kind: 'effect', scope: '国家', params: [
    { name: 'ideology', kind: 'enum', values: GOV_VALUES, block: true, optional: true },
    { name: 'long_name', kind: 'string', block: true, hint: '本地化键' },
    { name: 'name', kind: 'string', block: true, hint: '本地化键' }
  ] },
  { key: 'set_rule', zh: '修改游戏规则开关（如能否加入阵营）', cat: 'politics', kind: 'effect', scope: '国家', params: [
    { name: 'can_join_factions', kind: 'bool', block: true, optional: true },
    { name: 'can_decline_call_to_war', kind: 'bool', block: true, optional: true }
  ], example: 'set_rule = { can_join_factions = no }' },
  { key: 'add_manpower', zh: '增加人力', cat: 'politics', kind: 'effect', scope: '国家', params: [{ name: '数值', kind: 'number', hint: '负数表示扣除' }], example: 'add_manpower = 2500' },
  { key: 'set_party_popularity', zh: '设置政党支持率（旧写法）', cat: 'politics', kind: 'effect', scope: '国家', params: [{ name: '意识形态', kind: 'enum', values: GOV_VALUES, block: true }, { name: 'popularity', kind: 'number', block: true }] },
  { key: 'add_ideas', zh: '添加民族精神', cat: 'politics', kind: 'effect', scope: '国家', params: [{ name: '精神 id', kind: 'idea' }] },
  { key: 'remove_ideas', zh: '移除民族精神', cat: 'politics', kind: 'effect', scope: '国家', params: [{ name: '精神 id', kind: 'idea' }] },
  { key: 'swap_ideas', zh: '交换民族精神（旧换新）', cat: 'politics', kind: 'effect', scope: '国家', params: [
    { name: 'remove_idea', kind: 'idea', block: true },
    { name: 'add_idea', kind: 'idea', block: true }
  ] },
  { key: 'activate_advisor', zh: '启用顾问', cat: 'characters', kind: 'effect', scope: '国家', params: [{ name: '顾问 id', kind: 'idea' }] },
  { key: 'add_dynamic_modifier', zh: '添加动态修正', cat: 'economy', kind: 'effect', scope: '国家', params: [{ name: 'modifier', kind: 'string', block: true, hint: '修正 id' }] },

  // ---------- 外交 ----------
  { key: 'declare_war_on', zh: '对目标宣战', cat: 'diplomacy', kind: 'effect', scope: '国家', params: [
    { name: 'target', kind: 'tag', block: true },
    { name: 'type', kind: 'string', block: true, optional: true, hint: '如 annex / take_states / puppet' }
  ] },
  { key: 'create_wargoal', zh: '制造战争借口', cat: 'diplomacy', kind: 'effect', scope: '国家', params: [
    { name: 'target', kind: 'tag', block: true },
    { name: 'type', kind: 'enum', values: ['take_state', 'take_states', 'puppet', 'liberate', 'topple_government', 'independence', 'autonomy', 'demilitarize'], block: true },
    { name: 'generator', kind: 'string', block: true, optional: true, hint: '如 neighbours / home_territory' }
  ] },
  { key: 'white_peace', zh: '与目标白和平', cat: 'diplomacy', kind: 'effect', scope: '国家', params: [{ name: '国家', kind: 'tag' }] },
  { key: 'create_faction', zh: '创建阵营', cat: 'diplomacy', kind: 'effect', scope: '国家', params: [{ name: '阵营名', kind: 'string', hint: '阵营内部名（英文）' }], example: 'create_faction = my_alliance' },
  { key: 'create_faction_from_template', zh: '按阵营模板创建阵营', cat: 'diplomacy', kind: 'effect', scope: '国家', params: [{ name: '模板', kind: 'string' }] },
  { key: 'join_faction', zh: '加入阵营（旧写法，新版本用 add_to_faction）', cat: 'diplomacy', kind: 'effect', scope: '国家', params: [{ name: '阵营国', kind: 'tag' }] },
  { key: 'leave_faction', zh: '退出阵营', cat: 'diplomacy', kind: 'effect', scope: '国家', params: [{ name: 'yes/no', kind: 'bool' }], example: 'leave_faction = yes' },
  { key: 'add_to_faction', zh: '让目标加入我方阵营', cat: 'diplomacy', kind: 'effect', scope: '国家', params: [{ name: '国家', kind: 'tag' }] },
  { key: 'remove_from_faction', zh: '把目标踢出我方阵营', cat: 'diplomacy', kind: 'effect', scope: '国家', params: [{ name: '国家', kind: 'tag' }] },
  { key: 'set_faction_name', zh: '修改阵营名称', cat: 'diplomacy', kind: 'effect', scope: '国家', params: [{ name: '本地化键', kind: 'string' }] },
  { key: 'puppet', zh: '把目标傀儡化', cat: 'diplomacy', kind: 'effect', scope: '国家', params: [{ name: '国家', kind: 'tag' }], example: 'puppet = ROOT' },
  { key: 'end_puppet', zh: '结束对目标的傀儡关系', cat: 'diplomacy', kind: 'effect', scope: '国家', params: [{ name: '国家', kind: 'tag' }] },
  { key: 'release', zh: '释放目标为独立国家', cat: 'diplomacy', kind: 'effect', scope: '国家', params: [{ name: '国家', kind: 'tag' }] },
  { key: 'release_puppet_on_controlled', zh: '把我方控制的领地释放为傀儡', cat: 'diplomacy', kind: 'effect', scope: '国家', params: [{ name: '国家', kind: 'tag' }] },
  { key: 'set_autonomy', zh: '修改附庸的自治度', cat: 'diplomacy', kind: 'effect', scope: '国家', params: [
    { name: 'target', kind: 'tag', block: true },
    { name: 'autonomy_state', kind: 'string', block: true, hint: '如 autonomy_puppet / autonomy_free' },
    { name: 'freedom_level', kind: 'number', block: true, optional: true, hint: '0~1' }
  ] },
  { key: 'add_opinion_modifier', zh: '添加对目标的关系修正', cat: 'diplomacy', kind: 'effect', scope: '国家', params: [
    { name: 'target', kind: 'tag', block: true },
    { name: 'modifier', kind: 'string', block: true, hint: '本地化键' },
    { name: 'opinion', kind: 'number', block: true, optional: true }
  ] },
  { key: 'give_military_access', zh: '给予目标军事通行权', cat: 'diplomacy', kind: 'effect', scope: '国家', params: [{ name: '国家', kind: 'tag' }] },
  { key: 'set_cosmetic_tag', zh: '设置美化标签（换国名/国旗/颜色）', cat: 'diplomacy', kind: 'effect', scope: '国家', params: [{ name: '标签', kind: 'tag', hint: 'cosmetic tag 名' }] },
  { key: 'annex_country', zh: '吞并目标国家', cat: 'diplomacy', kind: 'effect', scope: '国家', params: [
    { name: 'target', kind: 'tag', block: true },
    { name: 'transfer_troops', kind: 'bool', block: true, optional: true }
  ], example: 'annex_country = { target = ROOT transfer_troops = yes }' },

  // ---------- 战争与领土 ----------
  { key: 'start_civil_war', zh: '爆发内战', cat: 'war', kind: 'effect', scope: '国家', params: [
    { name: 'ideology', kind: 'enum', values: GOV_VALUES, block: true },
    { name: 'ruling_party', kind: 'enum', values: GOV_VALUES, block: true, optional: true },
    { name: 'size', kind: 'number', block: true, optional: true, hint: '0~1' }
  ] },
  { key: 'set_state_owner_to', zh: '把州移交给目标国家', cat: 'war', kind: 'effect', scope: '州', params: [{ name: '国家', kind: 'tag' }] },
  { key: 'transfer_state_to', zh: '把州移交给目标国家', cat: 'war', kind: 'effect', scope: '州', params: [{ name: '国家', kind: 'tag' }] },
  { key: 'add_state_core', zh: '添加州核心', cat: 'war', kind: 'effect', scope: '国家/州', params: [{ name: '州 id', kind: 'number' }], example: 'add_state_core = 188' },
  { key: 'remove_state_core', zh: '移除州核心', cat: 'war', kind: 'effect', scope: '国家/州', params: [{ name: '州 id', kind: 'number' }] },
  { key: 'add_claim_by', zh: '让目标获得我方领土宣称', cat: 'war', kind: 'effect', scope: '州', params: [{ name: '国家', kind: 'tag' }] },
  { key: 'set_state_category', zh: '设置州类别（城市化程度）', cat: 'war', kind: 'effect', scope: '州', params: [{ name: '类别', kind: 'enum', values: ['pastoral', 'rural', 'town', 'large_town', 'city', 'large_city', 'metropolis', 'megalopolis'] }] },
  { key: 'set_capital', zh: '迁都', cat: 'war', kind: 'effect', scope: '国家', params: [{ name: 'state', kind: 'number', block: true, hint: '州 id' }] },
  { key: 'set_province_controller', zh: '设置省份控制者', cat: 'war', kind: 'effect', scope: '任意', params: [{ name: '省份 id', kind: 'number' }] },

  // ---------- 经济与科研 ----------
  { key: 'add_offsite_building', zh: '添加建筑（可跨州）', cat: 'economy', kind: 'effect', scope: '国家', params: [
    { name: 'type', kind: 'string', block: true, hint: '建筑 id，如 industrial_complex' },
    { name: 'level', kind: 'number', block: true, optional: true },
    { name: 'state', kind: 'number', block: true, optional: true, hint: '州 id' }
  ], example: 'add_offsite_building = { type = industrial_complex level = 1 }' },
  { key: 'add_resource', zh: '添加资源产出', cat: 'economy', kind: 'effect', scope: '州', params: [
    { name: 'type', kind: 'enum', values: ['steel', 'aluminium', 'oil', 'rubber', 'tungsten', 'chromium'], block: true },
    { name: 'amount', kind: 'number', block: true }
  ] },
  { key: 'add_research_slot', zh: '增加科研槽位', cat: 'economy', kind: 'effect', scope: '国家', params: [{ name: '数量', kind: 'number' }], example: 'add_research_slot = 1' },
  { key: 'set_technology', zh: '直接研究科技', cat: 'economy', kind: 'effect', scope: '国家', params: [{ name: 'tech_id', kind: 'string', block: true, hint: '科技 id，值为 1 表示已研究' }], example: 'set_technology = { infantry_weapons1 = 1 }' },
  { key: 'add_tech_bonus', zh: '添加科研加成（减时间）', cat: 'economy', kind: 'effect', scope: '国家', params: [
    { name: 'bonus', kind: 'number', block: true },
    { name: 'uses', kind: 'number', block: true },
    { name: 'technology', kind: 'string', block: true, optional: true },
    { name: 'category', kind: 'string', block: true, optional: true }
  ] },
  { key: 'add_fuel', zh: '增加燃油', cat: 'economy', kind: 'effect', scope: '国家', params: [{ name: '数值', kind: 'number' }] },
  { key: 'add_equipment_to_stockpile', zh: '向库存添加装备', cat: 'economy', kind: 'effect', scope: '国家', params: [
    { name: 'type', kind: 'string', block: true, hint: '装备 id' },
    { name: 'amount', kind: 'number', block: true },
    { name: 'producer', kind: 'tag', block: true, optional: true }
  ] },
  { key: 'create_equipment_variant', zh: '创建装备变体', cat: 'economy', kind: 'effect', scope: '国家', params: [
    { name: 'name', kind: 'string', block: true, hint: '本地化键' },
    { name: 'type', kind: 'string', block: true, hint: '装备 id' },
    { name: 'parent_version', kind: 'number', block: true, optional: true }
  ] },

  // ---------- 军事 ----------
  { key: 'add_army_experience', zh: '增加陆军经验', cat: 'military', kind: 'effect', scope: '国家', params: [{ name: '数值', kind: 'number' }] },
  { key: 'add_navy_experience', zh: '增加海军经验', cat: 'military', kind: 'effect', scope: '国家', params: [{ name: '数值', kind: 'number' }] },
  { key: 'add_air_experience', zh: '增加空军经验', cat: 'military', kind: 'effect', scope: '国家', params: [{ name: '数值', kind: 'number' }] },

  // ---------- 人物 ----------
  { key: 'add_country_leader_role', zh: '让角色担任领袖职位（需 1.13+）', cat: 'characters', kind: 'effect', scope: '国家', params: [
    { name: 'character', kind: 'char', block: true },
    { name: 'role', kind: 'string', block: true, optional: true, hint: '如 head_of_government / army_chief' }
  ] },
  { key: 'remove_country_leader_role', zh: '解除角色担任的领袖职位（需 1.13+）', cat: 'characters', kind: 'effect', scope: '国家', params: [{ name: 'character', kind: 'char', block: true }] },
  { key: 'create_country_leader', zh: '创建国家领袖', cat: 'characters', kind: 'effect', scope: '国家', params: [
    { name: 'name', kind: 'string', block: true, hint: '本地化键' },
    { name: 'desc', kind: 'string', block: true, optional: true, hint: '本地化键' },
    { name: 'picture', kind: 'string', block: true, hint: 'GFX 名' },
    { name: 'ideology', kind: 'enum', values: GOV_VALUES, block: true }
  ] },
  { key: 'retire_country_leader', zh: '让现任国家领袖退休', cat: 'characters', kind: 'effect', scope: '国家', params: [{ name: 'yes/no', kind: 'bool' }] },
  { key: 'kill_country_leader', zh: '杀死现任国家领袖', cat: 'characters', kind: 'effect', scope: '国家', params: [{ name: 'yes/no', kind: 'bool' }] },
  { key: 'recruit_character', zh: '招募角色（需要 common/characters 里已定义）', cat: 'characters', kind: 'effect', scope: '国家', params: [{ name: '角色 id', kind: 'char' }], example: 'recruit_character = FRA_Marcel_Cachin' },
  { key: 'promote_character', zh: '提拔角色（军衔晋升）', cat: 'characters', kind: 'effect', scope: '国家', params: [{ name: '角色 id', kind: 'char' }] },
  { key: 'set_character_name', zh: '修改角色显示名称', cat: 'characters', kind: 'effect', scope: '国家', params: [{ name: '角色 id', kind: 'char' }] },

  // ---------- 变量与标志 ----------
  { key: 'set_variable', zh: '设置变量', cat: 'variables', kind: 'effect', scope: '国家', params: [{ name: 'var = 值', kind: 'string', block: true, hint: '键为变量名，值为数值' }], example: 'set_variable = { my_var = 10 }' },
  { key: 'add_to_variable', zh: '给变量加值', cat: 'variables', kind: 'effect', scope: '国家', params: [{ name: 'var = 值', kind: 'string', block: true }] },
  { key: 'set_temp_variable', zh: '设置临时变量', cat: 'variables', kind: 'effect', scope: '国家', params: [{ name: 'var = 值', kind: 'string', block: true }] },
  { key: 'add_to_temp_variable', zh: '给临时变量加值', cat: 'variables', kind: 'effect', scope: '国家', params: [{ name: 'var = 值', kind: 'string', block: true }] },
  { key: 'set_country_flag', zh: '设置国家标志', cat: 'variables', kind: 'effect', scope: '国家', params: [{ name: '标志名', kind: 'string' }] },
  { key: 'clr_country_flag', zh: '清除国家标志', cat: 'variables', kind: 'effect', scope: '国家', params: [{ name: '标志名', kind: 'string' }] },
  { key: 'set_global_flag', zh: '设置全局标志', cat: 'variables', kind: 'effect', scope: '全局', params: [{ name: '标志名', kind: 'string' }] },
  { key: 'clr_global_flag', zh: '清除全局标志', cat: 'variables', kind: 'effect', scope: '全局', params: [{ name: '标志名', kind: 'string' }] },

  // ---------- 事件与随机 ----------
  { key: 'country_event', zh: '触发国家事件', cat: 'events', kind: 'effect', scope: '国家', params: [
    { name: 'id', kind: 'string', block: true, hint: '事件 id，如 my_mod.1' },
    { name: 'days', kind: 'number', block: true, optional: true },
    { name: 'hours', kind: 'number', block: true, optional: true },
    { name: 'random', kind: 'number', block: true, optional: true }
  ], example: 'country_event = { id = my_mod.1 days = 1 }' },
  { key: 'news_event', zh: '触发新闻事件', cat: 'events', kind: 'effect', scope: '国家', params: [
    { name: 'id', kind: 'string', block: true },
    { name: 'days', kind: 'number', block: true, optional: true },
    { name: 'hours', kind: 'number', block: true, optional: true },
    { name: 'random', kind: 'number', block: true, optional: true }
  ] },
  { key: 'random', zh: '以指定概率执行其内效果', cat: 'events', kind: 'effect', scope: '任意', params: [{ name: 'chance', kind: 'number', block: true, hint: '0~100' }] },
  { key: 'random_list', zh: '按权重随机执行一项（键为权重）', cat: 'events', kind: 'effect', scope: '任意', example: 'random_list = { 50 = { add_stability = 0.1 } 50 = { } }' },
  { key: 'add_timed_idea', zh: '添加限时民族精神', cat: 'events', kind: 'effect', scope: '国家', params: [
    { name: 'idea', kind: 'idea', block: true },
    { name: 'days', kind: 'number', block: true, optional: true }
  ] },

  // ---------- 触发条件 ----------
  { key: 'has_war', zh: '正处于战争中', cat: 'war', kind: 'trigger', scope: '国家', params: [{ name: 'yes/no', kind: 'bool' }] },
  { key: 'has_war_with', zh: '正与目标国家交战', cat: 'war', kind: 'trigger', scope: '国家', params: [{ name: '国家', kind: 'tag' }] },
  { key: 'has_civil_war', zh: '正处于内战中', cat: 'war', kind: 'trigger', scope: '国家', params: [{ name: 'yes/no', kind: 'bool' }] },
  { key: 'is_in_faction', zh: '在某个阵营中', cat: 'diplomacy', kind: 'trigger', scope: '国家', params: [{ name: 'yes/no', kind: 'bool' }] },
  { key: 'is_in_faction_with', zh: '与目标国家同一阵营', cat: 'diplomacy', kind: 'trigger', scope: '国家', params: [{ name: '国家', kind: 'tag' }] },
  { key: 'is_puppet', zh: '是傀儡国', cat: 'diplomacy', kind: 'trigger', scope: '国家', params: [{ name: 'yes/no', kind: 'bool' }] },
  { key: 'is_puppet_of', zh: '是目标国家的傀儡', cat: 'diplomacy', kind: 'trigger', scope: '国家', params: [{ name: '国家', kind: 'tag' }] },
  { key: 'is_subject', zh: '是附属国', cat: 'diplomacy', kind: 'trigger', scope: '国家', params: [{ name: 'yes/no', kind: 'bool' }] },
  { key: 'is_subject_of', zh: '是目标国家的附属国', cat: 'diplomacy', kind: 'trigger', scope: '国家', params: [{ name: '国家', kind: 'tag' }] },
  { key: 'has_government', zh: '政体为某意识形态', cat: 'politics', kind: 'trigger', scope: '国家', params: [{ name: '意识形态', kind: 'enum', values: GOV_VALUES }] },
  { key: 'is_major', zh: '是主要国家', cat: 'politics', kind: 'trigger', scope: '国家', params: [{ name: 'yes/no', kind: 'bool' }] },
  { key: 'is_ai', zh: '由 AI 控制', cat: 'politics', kind: 'trigger', scope: '国家', params: [{ name: 'yes/no', kind: 'bool' }] },
  { key: 'original_tag', zh: '原始国家标签为某国', cat: 'politics', kind: 'trigger', scope: '国家', params: [{ name: '国家', kind: 'tag' }] },
  { key: 'exists', zh: '目标国家存在', cat: 'politics', kind: 'trigger', scope: '国家', params: [{ name: 'yes/no', kind: 'bool' }] },
  { key: 'has_stability', zh: '稳定度达到条件', cat: 'politics', kind: 'trigger', scope: '国家', params: [{ name: '数值', kind: 'number', hint: '支持 > < >= <= = 比较' }], example: 'has_stability > 0.5' },
  { key: 'has_war_support', zh: '战争支持度达到条件', cat: 'politics', kind: 'trigger', scope: '国家', params: [{ name: '数值', kind: 'number', hint: '支持比较' }] },
  { key: 'has_political_power', zh: '政治点数达到条件', cat: 'politics', kind: 'trigger', scope: '国家', params: [{ name: '数值', kind: 'number', hint: '支持比较' }] },
  { key: 'has_manpower', zh: '人力达到条件', cat: 'military', kind: 'trigger', scope: '国家', params: [{ name: '数值', kind: 'number', hint: '支持比较' }] },
  { key: 'has_fuel', zh: '燃油达到条件', cat: 'economy', kind: 'trigger', scope: '国家', params: [{ name: '数值', kind: 'number', hint: '支持比较' }] },
  { key: 'num_of_factories', zh: '工厂总数达到条件', cat: 'economy', kind: 'trigger', scope: '国家', params: [{ name: '数值', kind: 'number', hint: '支持比较' }] },
  { key: 'num_of_military_factories', zh: '军工数达到条件', cat: 'economy', kind: 'trigger', scope: '国家', params: [{ name: '数值', kind: 'number', hint: '支持比较' }] },
  { key: 'num_of_civilian_factories', zh: '民工数达到条件', cat: 'economy', kind: 'trigger', scope: '国家', params: [{ name: '数值', kind: 'number', hint: '支持比较' }] },
  { key: 'num_of_naval_factories', zh: '船坞数达到条件', cat: 'economy', kind: 'trigger', scope: '国家', params: [{ name: '数值', kind: 'number', hint: '支持比较' }] },
  { key: 'has_army_size', zh: '陆军规模达到条件', cat: 'military', kind: 'trigger', scope: '国家', params: [{ name: 'size', kind: 'number', block: true, hint: '支持比较' }], example: 'has_army_size = { size > 75 }' },
  { key: 'has_equipment', zh: '拥有装备数量达到条件', cat: 'military', kind: 'trigger', scope: '国家', params: [
    { name: 'type', kind: 'string', block: true, hint: '装备 id' },
    { name: 'amount', kind: 'number', block: true, optional: true }
  ] },
  { key: 'has_technology', zh: '已研究某科技', cat: 'economy', kind: 'trigger', scope: '国家', params: [{ name: '科技 id', kind: 'string' }] },
  { key: 'has_completed_focus', zh: '已完成某国策', cat: 'politics', kind: 'trigger', scope: '国家', params: [{ name: '国策 id', kind: 'focus' }] },
  { key: 'has_focus_tree', zh: '使用某国策树', cat: 'politics', kind: 'trigger', scope: '国家', params: [{ name: '国策树 id', kind: 'string' }] },
  { key: 'has_idea', zh: '拥有某民族精神', cat: 'politics', kind: 'trigger', scope: '国家', params: [{ name: '精神 id', kind: 'idea' }] },
  { key: 'has_country_flag', zh: '国家标志已设置', cat: 'variables', kind: 'trigger', scope: '国家', params: [{ name: '标志名', kind: 'string' }] },
  { key: 'has_global_flag', zh: '全局标志已设置', cat: 'variables', kind: 'trigger', scope: '全局', params: [{ name: '标志名', kind: 'string' }] },
  { key: 'has_variable', zh: '变量已设置', cat: 'variables', kind: 'trigger', scope: '国家', params: [{ name: '变量名', kind: 'string' }] },
  { key: 'check_variable', zh: '变量值满足比较', cat: 'variables', kind: 'trigger', scope: '国家', params: [{ name: 'var > 值', kind: 'string', block: true, hint: '键为变量名' }], example: 'check_variable = { my_var > 10 }' },
  { key: 'has_opinion', zh: '对目标好感度达到条件', cat: 'diplomacy', kind: 'trigger', scope: '国家', params: [
    { name: 'target', kind: 'tag', block: true },
    { name: 'value', kind: 'number', block: true, hint: '支持比较' }
  ] },
  { key: 'has_autonomy_state', zh: '自治度为某状态', cat: 'diplomacy', kind: 'trigger', scope: '国家', params: [{ name: '自治状态', kind: 'enum', values: ['autonomy_free', 'autonomy_dominion', 'autonomy_colony', 'autonomy_puppet', 'autonomy_integrated_puppet', 'autonomy_satellite', 'autonomy_reichskommissariat', 'autonomy_imperial_protectorate', 'autonomy_supervised_state'] }] },
  { key: 'has_country_leader', zh: '现任国家领袖满足条件', cat: 'characters', kind: 'trigger', scope: '国家', params: [{ name: 'yes/no', kind: 'bool' }] },
  { key: 'has_country_leader_with_trait', zh: '现任国家领袖拥有某特质', cat: 'characters', kind: 'trigger', scope: '国家', params: [{ name: '特质 id', kind: 'string' }] },
  { key: 'has_character', zh: '已招募某角色', cat: 'characters', kind: 'trigger', scope: '国家', params: [{ name: '角色 id', kind: 'char' }] },
  { key: 'controls_state', zh: '控制某州（州作用域下）', cat: 'map', kind: 'trigger', scope: '州', params: [{ name: '国家', kind: 'tag' }] },
  { key: 'owns_state', zh: '拥有某州', cat: 'map', kind: 'trigger', scope: '国家', params: [{ name: '州 id', kind: 'number' }] },
  { key: 'is_controlled_by', zh: '州由某国控制（州作用域下）', cat: 'map', kind: 'trigger', scope: '州', params: [{ name: '国家', kind: 'tag' }] },
  { key: 'is_core_of', zh: '州是某国的核心', cat: 'map', kind: 'trigger', scope: '州', params: [{ name: '国家', kind: 'tag' }] },
  { key: 'surrender_progress', zh: '投降倾向达到条件', cat: 'war', kind: 'trigger', scope: '国家', params: [{ name: '数值', kind: 'number', hint: '支持比较' }] },
  { key: 'threat', zh: '世界紧张度达到条件', cat: 'diplomacy', kind: 'trigger', scope: '全局', params: [{ name: '数值', kind: 'number', hint: '支持比较' }], example: 'threat > 0.5' },
  { key: 'date', zh: '当前日期满足比较', cat: 'logic', kind: 'trigger', scope: '全局', params: [{ name: '日期', kind: 'string', hint: '如 1939.9.1，支持比较' }], example: 'date > 1939.9.1' },
  { key: 'any_country', zh: '存在满足条件的任意国家', cat: 'logic', kind: 'trigger', scope: '任意' },
  { key: 'any_other_country', zh: '存在满足条件的其它国家', cat: 'logic', kind: 'trigger', scope: '任意' },
  { key: 'all_other_country', zh: '所有其它国家都满足条件', cat: 'logic', kind: 'trigger', scope: '任意' },
  { key: 'any_state', zh: '存在满足条件的任意州', cat: 'logic', kind: 'trigger', scope: '任意' },
  { key: 'all_state', zh: '所有州都满足条件', cat: 'logic', kind: 'trigger', scope: '任意' },
  { key: 'any_neighbor_country', zh: '存在满足条件的邻国', cat: 'logic', kind: 'trigger', scope: '国家' }
]

/** 按键查目录 */
export function condSpec(key: string): CondSpec | undefined {
  return COND_CATALOG.find((s) => s.key === key)
}

/** 按分类分组（用于选择器） */
export function condSpecsByCat(): { cat: CondCat; zh: string; list: CondSpec[] }[] {
  const out: { cat: CondCat; zh: string; list: CondSpec[] }[] = []
  for (const [cat, zh] of Object.entries(CAT_ZH) as [CondCat, string][]) {
    const list = COND_CATALOG.filter((s) => s.cat === cat)
    if (list.length > 0) out.push({ cat, zh, list })
  }
  return out
}

/**
 * 自动补全：分级匹配
 * t0 英文前缀 → t1 中文说明前缀 → t2 英文包含 → t3 分类名精确命中（如「军事」）→ t4 中文说明/分类包含
 * 纯英文输入时 t1/t3/t4 基本为空，与仅按 key 匹配的旧行为逐条等价。
 */
export function suggestCondKeys(filter: string, limit = 30): CondSpec[] {
  const f = filter.trim().toLowerCase()
  if (!f) return []
  const seen = new Set<CondSpec>()
  const out: CondSpec[] = []
  const push = (list: CondSpec[]): void => {
    for (const s of list) {
      if (!seen.has(s) && out.length < limit) {
        seen.add(s)
        out.push(s)
      }
    }
  }
  push(COND_CATALOG.filter((s) => s.key.toLowerCase().startsWith(f)))
  push(COND_CATALOG.filter((s) => s.zh.toLowerCase().startsWith(f)))
  push(COND_CATALOG.filter((s) => s.key.toLowerCase().includes(f)))
  push(COND_CATALOG.filter((s) => CAT_ZH[s.cat].toLowerCase() === f))
  push(COND_CATALOG.filter((s) => (s.zh + ' ' + CAT_ZH[s.cat]).toLowerCase().includes(f)))
  return out
}

// ---------- 条件树模型 ----------

export interface CondNode {
  key: string
  /** 标量参数（保持 token 原文，含比较符如 < 或 >） */
  args: string[]
  /** 嵌套子节点 */
  children: CondNode[]
}

export function makeCondNode(key: string): CondNode {
  return { key, args: [], children: [] }
}

/** 从已解析的块条目递归读取条件树（跳过已删除条目） */
export function parseCondBlock(block: CwBlock): CondNode[] {
  const nodes: CondNode[] = []
  for (const it of block.items) {
    if (it.deleted) continue
    if (it.kind === 'bare-item' && it.value?.kind === 'scalar') {
      // 比较式触发器（如 has_stability > 0.5）在解析器里是连续裸值：
      // 第一个裸值是键；运算符或「前节点参数全是运算符」时并入前节点（key OP value）
      const text = it.value.token.text
      const prev = nodes[nodes.length - 1]
      const prevAllOps = prev !== undefined && prev.args.length > 0 && prev.args.every(isCondOperator)
      if (prev && prev.children.length === 0 && (isCondOperator(text) || prevAllOps)) {
        prev.args.push(text)
      } else {
        nodes.push({ key: text, args: [], children: [] })
      }
      continue
    }
    if (it.kind !== 'entry' || !it.key || !it.value) continue
    if (it.value.kind === 'scalar') {
      nodes.push({ key: it.key.text, args: [it.value.token.text], children: [] })
    } else {
      nodes.push({ key: it.key.text, args: [], children: parseCondBlock(it.value) })
    }
  }
  return nodes
}

/** 渲染条件树为多行文本（不含外层键名；每行按深度用 \t 缩进；base 为首层深度；newline 用文件自身的换行符） */
export function renderCondNodes(nodes: CondNode[], base = 0, newline = '\n'): string {
  const lines: string[] = []
  const walk = (list: CondNode[], depth: number): void => {
    for (const n of list) {
      const ind = '\t'.repeat(depth)
      // 比较式（key OP value）不加等号；普通标量写成 key = value
      const args =
        n.args.length > 0
          ? isCondOperator(n.args[0])
            ? ' ' + n.args.join(' ')
            : ' = ' + n.args.join(' ')
          : ''
      if (n.children.length === 0) {
        lines.push(`${ind}${n.key}${args}`)
      } else {
        lines.push(`${ind}${n.key}${args} = {`)
        walk(n.children, depth + 1)
        lines.push(`${ind}}`)
      }
    }
  }
  walk(nodes, base)
  return lines.join(newline)
}

/** 渲染完整的「key = { … }」条目文本 */
export function condBlockText(key: string, nodes: CondNode[], newline = '\n'): string {
  if (nodes.length === 0) return `${key} = { }`
  return `${key} = {${newline}${renderCondNodes(nodes, 1, newline)}${newline}}`
}

/** 判断参数是否为比较运算符 */
export function isCondOperator(s: string): boolean {
  return s === '>' || s === '<' || s === '>=' || s === '<=' || s === '=' || s === '!=' || s === '>1'
}

// ---------- 条目内条件块的读取与整体替换（国策/事件/决议通用） ----------

/** 读取条目里的条件/效果块（available / trigger / completion_reward 等）；不存在时返回 null */
export function getCondBlockOf(entry: CwItem, key: string): CondNode[] | null {
  if (!entry.value || entry.value.kind !== 'block') return null
  const it = findEntry(entry.value.items, key)
  if (!it || it.deleted || !it.value || it.value.kind !== 'block') return null
  return parseCondBlock(it.value)
}

/**
 * 整体替换条目里的条件/效果块为规范化多行写法（结构化编辑保存）。
 * nodes 为空 → 删除该条目；只有被替换的块会重写，其余字节保持原样。
 * 已存在的条目保留原来的位置和行尾注释；新建条目沿用文件里的换行符。
 */
export function setCondBlockOf(entry: CwItem, key: string, nodes: CondNode[]): void {
  if (!entry.value || entry.value.kind !== 'block') return
  const items = entry.value.items
  const it = findEntry(items, key)
  if (nodes.length === 0) {
    if (it) it.deleted = true
    return
  }
  // 换行符沿用文件自身的（从本块其它条目里找），保持整个文件一致
  let nl = '\n'
  for (const sib of items) {
    if (sib.deleted) continue
    const t = sib.leading.find((x) => x.kind === 'newline')
    if (t) {
      nl = t.text
      break
    }
  }
  const parsed = parseFile(condBlockText(key, nodes, nl), 'txt').file
  const ni = parsed?.items[0]
  if (!ni) return
  // 换进来的子树全部标记 dirty：干净条目会按 rawStart/rawEnd 切原文件的字节，
  // 而这里的偏移来自另一个 parse，必须全部重新渲染
  const markTreeDirty = (it: CwItem): void => {
    it.dirty = true
    if (it.value?.kind === 'block') for (const c of it.value.items) markTreeDirty(c)
  }
  markTreeDirty(ni)
  const makeNl = (): { kind: 'newline'; text: string; start: number; end: number } => ({
    kind: 'newline',
    text: nl,
    start: 0,
    end: nl.length
  })
  if (it) {
    const hasNl = it.leading.some((t) => t.kind === 'newline')
    ni.leading = hasNl ? it.leading : [makeNl()]
    ni.trailing = it.trailing
    items[items.indexOf(it)] = ni
  } else {
    // 曾被删除的同名块：原地恢复，保持行序不变（删除后又重新添加条件时）
    const dead = items.find((x) => x.deleted && x.kind === 'entry' && x.key?.text === key)
    if (dead) {
      const hasNl = dead.leading.some((t) => t.kind === 'newline')
      ni.leading = hasNl ? dead.leading : [makeNl()]
      ni.trailing = dead.trailing
      items[items.indexOf(dead)] = ni
    } else {
      ni.leading = [makeNl()]
      items.push(ni)
    }
  }
}
