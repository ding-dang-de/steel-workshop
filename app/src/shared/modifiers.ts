/**
 * 修饰符（modifier）目录 —— 民族精神/特质编辑器自动补全用
 *
 * 收录游戏常用修饰符的中文说明；覆盖用户 mod 已用到的全部修饰符（ideas/characters/decisions）。
 * pct 表示游戏内按百分比显示（0.1 = +10%），编辑器里可换算展示。
 * 未收录的修饰符仍可自由填写，只是没有中文说明。
 */

export type ModCat = '政治' | '军事' | '经济' | '科研' | '外交' | '其他'

export interface ModifierSpec {
  key: string
  /** 中文说明 */
  zh: string
  cat: ModCat
  /** 游戏内按百分比显示（值为 0.1 表示 +10%） */
  pct?: boolean
  note?: string
}

export const MOD_CAT_ZH: ModCat[] = ['政治', '军事', '经济', '科研', '外交', '其他']

export const MODIFIER_CATALOG: ModifierSpec[] = [
  // ---------- 政治 ----------
  { key: 'political_power_gain', zh: '每日政治点数获取', cat: '政治' },
  { key: 'political_power_factor', zh: '政治点数获取修正', cat: '政治', pct: true },
  { key: 'stability_factor', zh: '稳定度', cat: '政治', pct: true },
  { key: 'stability_weekly', zh: '每周稳定度变化', cat: '政治', pct: true },
  { key: 'war_support_factor', zh: '战争支持度', cat: '政治', pct: true },
  { key: 'war_support_weekly', zh: '每周战争支持度变化', cat: '政治', pct: true },
  { key: 'surrender_limit', zh: '投降界限', cat: '政治', pct: true },
  { key: 'weekly_manpower', zh: '每周人力', cat: '政治' },
  { key: 'recruitable_population_factor', zh: '可征召人口比例', cat: '政治', pct: true },
  { key: 'recruitable_population', zh: '可征召人口比例', cat: '政治', pct: true },
  { key: 'mobilization_speed', zh: '动员速度', cat: '政治', pct: true },
  { key: 'conscription_factor', zh: '征兵法案人力修正', cat: '政治', pct: true },
  { key: 'training_time_factor', zh: '部队训练时间', cat: '政治', pct: true },
  { key: 'training_time_army_factor', zh: '陆军训练时间', cat: '政治', pct: true },
  { key: 'party_popularity_stability_factor', zh: '党派支持度对稳定度的影响', cat: '政治', pct: true },
  { key: 'political_power_cost_factor', zh: '政治点数消耗（任命/决议等）', cat: '政治', pct: true },
  { key: 'resistance_growth_factor', zh: '抵抗增长速度', cat: '政治', pct: true },
  { key: 'resistance_target', zh: '抵抗目标值', cat: '政治', pct: true },
  { key: 'resistance_damage_to_garrison', zh: '抵抗对驻军的伤害', cat: '政治', pct: true },
  { key: 'compliance_growth', zh: '顺从度增长速度', cat: '政治', pct: true },
  { key: 'autonomy_gain_factor', zh: '自治度增长速度', cat: '政治', pct: true },
  { key: 'democratic_drift', zh: '每日民主主义支持度', cat: '政治' },
  { key: 'communism_drift', zh: '每日共产主义支持度', cat: '政治' },
  { key: 'fascism_drift', zh: '每日法西斯主义支持度', cat: '政治' },
  { key: 'neutrality_drift', zh: '每日中立主义支持度', cat: '政治' },
  { key: 'ideology_drift_defence_factor', zh: '意识形态防御（抵抗外部宣传）', cat: '政治', pct: true },
  { key: 'drift_defence_factor', zh: '意识形态防御（抵抗外部宣传）', cat: '政治', pct: true },
  { key: 'justify_war_goal_time', zh: '正当化战争目标时间', cat: '政治', pct: true },
  { key: 'send_volunteer_size', zh: '可派遣志愿军数量', cat: '政治' },
  { key: 'send_volunteers_factor', zh: '可派遣志愿军数量修正', cat: '政治', pct: true },
  { key: 'pp_boost', zh: '一次性政治点数加成', cat: '政治' },
  { key: 'conscription', zh: '征兵法案人力修正', cat: '政治', pct: true },
  { key: 'unity_factor', zh: '国家统一度', cat: '政治', pct: true },

  // ---------- 军事 ----------
  { key: 'army_org_factor', zh: '陆军组织度', cat: '军事', pct: true },
  { key: 'army_org_regain', zh: '陆军组织度恢复速度', cat: '军事', pct: true },
  { key: 'army_morale_factor', zh: '陆军士气（组织度恢复）', cat: '军事', pct: true },
  { key: 'army_speed_factor', zh: '陆军移动速度', cat: '军事', pct: true },
  { key: 'army_attack_factor', zh: '陆军攻击', cat: '军事', pct: true },
  { key: 'army_defence_factor', zh: '陆军防御', cat: '军事', pct: true },
  { key: 'army_core_attack_factor', zh: '陆军核心领土攻击', cat: '军事', pct: true },
  { key: 'army_core_defence_factor', zh: '陆军核心领土防御', cat: '军事', pct: true },
  { key: 'army_experience_gain_factor', zh: '陆军经验获取', cat: '军事', pct: true },
  { key: 'army_experience_gain_army', zh: '陆军经验每日获取', cat: '军事', pct: true },
  { key: 'army_experience_gain_air', zh: '空军经验每日获取', cat: '军事', pct: true },
  { key: 'army_experience_gain_navy', zh: '海军经验每日获取', cat: '军事', pct: true },
  { key: 'land_reinforce_rate', zh: '陆军增援速度', cat: '军事', pct: true },
  { key: 'attrition', zh: '部队损耗', cat: '军事', pct: true },
  { key: 'heat_attrition_factor', zh: '炎热损耗', cat: '军事', pct: true },
  { key: 'cold_attrition_factor', zh: '寒冷损耗', cat: '军事', pct: true },
  { key: 'winter_attrition_factor', zh: '冬季损耗', cat: '军事', pct: true },
  { key: 'supply_consumption_factor', zh: '补给消耗', cat: '军事', pct: true },
  { key: 'fuel_gain_factor', zh: '燃料获取', cat: '军事', pct: true },
  { key: 'planning_speed', zh: '计划速度', cat: '军事', pct: true },
  { key: 'planning_decay', zh: '计划衰减', cat: '军事', pct: true },
  { key: 'entrenchment_speed_factor', zh: '堑壕挖掘速度', cat: '军事', pct: true },
  { key: 'dig_in_speed_factor', zh: '堑壕挖掘速度', cat: '军事', pct: true },
  { key: 'special_forces_cap', zh: '特种部队上限', cat: '军事', pct: true },
  { key: 'special_forces_attack_factor', zh: '特种部队攻击', cat: '军事', pct: true },
  { key: 'special_forces_defense_factor', zh: '特种部队防御', cat: '军事', pct: true },
  { key: 'special_forces_out_of_supply_factor', zh: '特种部队断补给惩罚', cat: '军事', pct: true },
  { key: 'special_forces_no_supply_grace', zh: '特种部队补给宽限时间', cat: '军事' },
  { key: 'air_attack_factor', zh: '空军对地攻击', cat: '军事', pct: true },
  { key: 'air_defence_factor', zh: '空军防御', cat: '军事', pct: true },
  { key: 'air_agility_factor', zh: '空军机动性', cat: '军事', pct: true },
  { key: 'air_range_factor', zh: '空军航程', cat: '军事', pct: true },
  { key: 'air_accidents_factor', zh: '空军事故率', cat: '军事', pct: true },
  { key: 'air_superiority_factor', zh: '制空权效率', cat: '军事', pct: true },
  { key: 'air_bombing_targetting', zh: '战略轰炸精度', cat: '军事', pct: true },
  { key: 'naval_strike_attack_factor', zh: '海军轰炸攻击', cat: '军事', pct: true },
  { key: 'air_wing_xp_gain_factor', zh: '空军联队经验获取', cat: '军事', pct: true },
  { key: 'navy_org_factor', zh: '海军组织度', cat: '军事', pct: true },
  { key: 'naval_speed_factor', zh: '海军航速', cat: '军事', pct: true },
  { key: 'naval_damage_factor', zh: '海军伤害', cat: '军事', pct: true },
  { key: 'naval_defense_factor', zh: '海军防御', cat: '军事', pct: true },
  { key: 'naval_invasion_capacity', zh: '海军入侵规模', cat: '军事', pct: true },
  { key: 'naval_invasion_defend_factor', zh: '防御海军入侵能力', cat: '军事', pct: true },
  { key: 'convoy_escort_efficiency', zh: '护航效率', cat: '军事', pct: true },
  { key: 'navy_anti_air_attack_factor', zh: '舰船防空攻击', cat: '军事', pct: true },
  { key: 'submarine_detection', zh: '潜艇探测', cat: '军事', pct: true },
  { key: 'military_factory_start_efficiency_factor', zh: '新建军工初始效率', cat: '军事', pct: true },
  { key: 'military_staff_cost_factor', zh: '军事参谋成本', cat: '军事', pct: true },
  { key: 'army_chief_cost_factor', zh: '陆军总司令成本', cat: '军事', pct: true },
  { key: 'army_leader_cost_factor', zh: '陆军将领成本', cat: '军事', pct: true },
  { key: 'air_chief_cost_factor', zh: '空军总司令成本', cat: '军事', pct: true },
  { key: 'navy_chief_cost_factor', zh: '海军总司令成本', cat: '军事', pct: true },
  { key: 'high_command_cost_factor', zh: '高级指挥部成本', cat: '军事', pct: true },
  { key: 'military_leader_cost_factor', zh: '军事将领成本', cat: '军事', pct: true },
  { key: 'military_leader_capacity', zh: '将领容量', cat: '军事' },
  { key: 'command_power_gain', zh: '每日指挥点数', cat: '军事' },
  { key: 'command_power_gain_mult', zh: '指挥点数获取修正', cat: '军事', pct: true },
  { key: 'max_command_power', zh: '指挥点数上限', cat: '军事' },
  { key: 'max_command_power_mult', zh: '指挥点数上限修正', cat: '军事', pct: true },
  { key: 'garrison_manpower_need', zh: '驻军人力需求', cat: '军事', pct: true },
  { key: 'division_defense_factor', zh: '部队防御', cat: '军事', pct: true },
  { key: 'division_attack_factor', zh: '部队攻击', cat: '军事', pct: true },
  { key: 'combat_width_factor', zh: '战场宽度', cat: '军事', pct: true },
  { key: 'recon_factor', zh: '侦察效率', cat: '军事', pct: true },
  { key: 'experience_gain_factor', zh: '经验获取', cat: '军事', pct: true },
  { key: 'experience_gain_army_unit_factor', zh: '陆军部队经验获取', cat: '军事', pct: true },
  { key: 'experience_gain_air_unit_factor', zh: '空军部队经验获取', cat: '军事', pct: true },
  { key: 'experience_gain_navy_unit_factor', zh: '海军部队经验获取', cat: '军事', pct: true },
  { key: 'land_night_attack', zh: '陆军夜间攻击', cat: '军事', pct: true },
  { key: 'army_bonus_air_superiority_factor', zh: '制空权对陆军加成', cat: '军事', pct: true },
  { key: 'casualties_of_enemy', zh: '敌方伤亡', cat: '军事', pct: true },
  { key: 'war_exhaustion_factor', zh: '战争疲劳增长速度', cat: '军事', pct: true },

  // ---------- 经济 ----------
  { key: 'consumer_goods_factor', zh: '生活消费品工厂比例', cat: '经济', pct: true },
  { key: 'production_factory_efficiency_gain_factor', zh: '工厂生产效率增长', cat: '经济', pct: true },
  { key: 'production_factory_max_efficiency_factor', zh: '工厂生产效率上限', cat: '经济', pct: true },
  { key: 'production_speed_buildings_factor', zh: '建设速度', cat: '经济', pct: true },
  { key: 'industrial_capacity_factory', zh: '工厂产出', cat: '经济', pct: true },
  { key: 'industrial_capacity_dockyard', zh: '船坞产出', cat: '经济', pct: true },
  { key: 'production_speed_arms_factory_factor', zh: '军工生产速度', cat: '经济', pct: true },
  { key: 'production_speed_naval_shipyard_factor', zh: '船坞生产速度', cat: '经济', pct: true },
  { key: 'local_factory_sabotage', zh: '工厂被破坏率', cat: '经济', pct: true },
  { key: 'industry_repair_factor', zh: '工厂修复速度', cat: '经济', pct: true },
  { key: 'line_change_production_efficiency_factor', zh: '切换生产线效率损失', cat: '经济', pct: true },
  { key: 'global_building_slots_factor', zh: '建筑槽位', cat: '经济', pct: true },
  { key: 'civilian_factory_use', zh: '民用工厂可用比例', cat: '经济', pct: true },
  { key: 'production_oil_factor', zh: '原油产量', cat: '经济', pct: true },
  { key: 'resources_to_market_factor', zh: '出口资源比例', cat: '经济', pct: true },
  { key: 'trade_opinion_factor', zh: '贸易关系改善速度', cat: '经济', pct: true },
  { key: 'trade_deal_opinion_factor', zh: '贸易协定关系影响', cat: '经济', pct: true },
  { key: 'exports_factor', zh: '出口修正', cat: '经济', pct: true },
  { key: 'imports_factor', zh: '进口修正', cat: '经济', pct: true },
  { key: 'free_trade_opinion_factor', zh: '自由贸易关系改善', cat: '经济', pct: true },
  { key: 'infrastructure_construction_speed_factor', zh: '基础设施建设速度', cat: '经济', pct: true },
  { key: 'industrial_complex_construction_speed_factor', zh: '工厂建设速度', cat: '经济', pct: true },
  { key: 'railway_construction_speed_factor', zh: '铁路建设速度', cat: '经济', pct: true },
  { key: 'refinery_construction_speed_factor', zh: '炼油厂建设速度', cat: '经济', pct: true },
  { key: 'supply_node_range', zh: '补给节点范围', cat: '经济', pct: true },
  { key: 'supply_range_factor', zh: '补给范围', cat: '经济', pct: true },
  { key: 'local_supplies', zh: '本地补给', cat: '经济', pct: true },
  { key: 'local_non_core_supplies', zh: '非核心领土本地补给', cat: '经济', pct: true },
  { key: 'railway_range_factor', zh: '铁路补给范围', cat: '经济', pct: true },
  { key: 'motorized_supply_factor', zh: '摩托化补给', cat: '经济', pct: true },
  { key: 'dockyard_construction_speed_factor', zh: '船坞建设速度', cat: '经济', pct: true },
  { key: 'factory_damage_factor', zh: '工厂损坏（轰炸）', cat: '经济', pct: true },
  { key: 'conversion_speed_buildings_factor', zh: '建筑转换速度', cat: '经济', pct: true },
  { key: 'efficiency_cap_factor', zh: '生产效率上限', cat: '经济', pct: true },
  { key: 'production_lack_of_resource_penalty_factor', zh: '缺资源生产惩罚', cat: '经济', pct: true },

  // ---------- 科研 ----------
  { key: 'research_speed_factor', zh: '科研速度', cat: '科研', pct: true },
  { key: 'research_bonus_from_politics', zh: '政治对科研的加成', cat: '科研', pct: true },
  { key: 'research_sharing_per_country_bonus_factor', zh: '科研共享每国加成', cat: '科研', pct: true },
  { key: 'civilian_research_factor', zh: '民用科技研究速度', cat: '科研', pct: true },
  { key: 'air_research_factor', zh: '空军科技研究速度', cat: '科研', pct: true },
  { key: 'naval_research_factor', zh: '海军科技研究速度', cat: '科研', pct: true },
  { key: 'army_research_factor', zh: '陆军科技研究速度', cat: '科研', pct: true },
  { key: 'electronics_research_factor', zh: '电子科技研究速度', cat: '科研', pct: true },
  { key: 'industry_research_factor', zh: '工业科技研究速度', cat: '科研', pct: true },
  { key: 'nuclear_production_factor', zh: '核弹生产速度', cat: '科研', pct: true },
  { key: 'encryption', zh: '加密强度', cat: '科研', pct: true },
  { key: 'decryption', zh: '解密能力', cat: '科研', pct: true },
  { key: 'intel_network_gain', zh: '情报网渗透速度', cat: '科研', pct: true },
  { key: 'intel_from_operatives_factor', zh: '特工情报获取', cat: '科研', pct: true },
  { key: 'operative_slots', zh: '特工槽位', cat: '科研' },
  { key: 'agency_upgrade_time', zh: '情报机构升级时间', cat: '科研', pct: true },
  { key: 'rocket_site_production_factor', zh: '火箭基地生产速度', cat: '科研', pct: true },

  // ---------- 外交 ----------
  { key: 'opinion_gain_monthly_factor', zh: '每月关系改善', cat: '外交', pct: true },
  { key: 'opinion_gain_monthly_same_ideology', zh: '同意识形态每月关系改善', cat: '外交', pct: true },
  { key: 'diplomatic_acceptance_factor', zh: '外交提议接受度', cat: '外交', pct: true },
  { key: 'join_faction_diplomatic_acceptance', zh: '加入阵营提议接受度', cat: '外交', pct: true },
  { key: 'trade_diplomatic_acceptance', zh: '贸易提议接受度', cat: '外交', pct: true },
  { key: 'tension_generation_factor', zh: '世界紧张度产生', cat: '外交', pct: true },
  { key: 'tension_impact_on_guarantee', zh: '紧张度对保证独立的影响', cat: '外交', pct: true },
  { key: 'wargoal_justify_time_factor', zh: '正当化战争目标时间', cat: '外交', pct: true },
  { key: 'guarantee_cost_factor', zh: '保证独立成本', cat: '外交', pct: true },
  { key: 'puppet_cost_factor', zh: '傀儡成本', cat: '外交', pct: true },
  { key: 'license_purchase_cost_factor', zh: '购买生产许可成本', cat: '外交', pct: true },
  { key: 'license_sell_acceptance_factor', zh: '出售生产许可接受度', cat: '外交', pct: true },
  { key: 'lend_lease_request_acceptance_factor', zh: '租借请求接受度', cat: '外交', pct: true },
  { key: 'lend_lease_tension_factor', zh: '租借对紧张度的影响', cat: '外交', pct: true },
  { key: 'faction_trade_opinion_factor', zh: '阵营内贸易关系', cat: '外交', pct: true },
  { key: 'dockyard_repair_speed_factor', zh: '船坞修理速度', cat: '外交', pct: true },

  // ---------- 其他 ----------
  { key: 'max_planning_factor', zh: '计划上限', cat: '其他', pct: true },
  { key: 'experience_gain_army', zh: '陆军经验每日获取', cat: '其他' },
  { key: 'experience_gain_navy', zh: '海军经验每日获取', cat: '其他' },
  { key: 'experience_gain_air', zh: '空军经验每日获取', cat: '其他' },
  { key: 'minimum_training_level', zh: '最低训练等级', cat: '其他' },
  { key: 'minimum_conscription', zh: '最低征兵水平', cat: '其他', pct: true },
  { key: 'minimum_training_time', zh: '最低训练时间', cat: '其他' },
  { key: 'civil_war_involvement_tension', zh: '内战参与所需紧张度', cat: '其他' },
  { key: 'legitimacy_daily', zh: '每日合法性', cat: '其他' },
  { key: 'legitimacy_weekly', zh: '每周合法性', cat: '其他' },
  { key: 'global_tension', zh: '世界紧张度', cat: '其他' },
  { key: 'stability_hit_factor', zh: '稳定度打击', cat: '其他', pct: true },
  { key: 'daily_political_power_cost', zh: '每日政治点数消耗', cat: '其他' },
  { key: 'daily_command_power_cost', zh: '每日指挥点数消耗', cat: '其他' }
]

export function findModifier(key: string): ModifierSpec | null {
  return MODIFIER_CATALOG.find((s) => s.key === key) ?? null
}

/**
 * 自动补全：分级匹配
 * t0 英文前缀 → t1 中文说明前缀 → t2 英文包含 → t3 分类名精确命中（如「军事」）→ t4 中文说明/分类包含
 * 纯英文输入时 t1/t3/t4 基本为空，与仅按 key 匹配的旧行为逐条等价。
 */
export function suggestModifierKeys(filter: string, limit = 12): ModifierSpec[] {
  const f = filter.trim().toLowerCase()
  if (!f) return []
  const seen = new Set<ModifierSpec>()
  const out: ModifierSpec[] = []
  const push = (list: ModifierSpec[]): void => {
    for (const s of list) {
      if (!seen.has(s) && out.length < limit) {
        seen.add(s)
        out.push(s)
      }
    }
  }
  push(MODIFIER_CATALOG.filter((s) => s.key.toLowerCase().startsWith(f)))
  push(MODIFIER_CATALOG.filter((s) => s.zh.toLowerCase().startsWith(f)))
  push(MODIFIER_CATALOG.filter((s) => s.key.toLowerCase().includes(f)))
  push(MODIFIER_CATALOG.filter((s) => s.cat.toLowerCase() === f))
  push(MODIFIER_CATALOG.filter((s) => (s.zh + ' ' + s.cat).toLowerCase().includes(f)))
  return out
}

/** 百分比显示换算：0.1 → '+10%'；非百分比原样 */
export function formatModifierValue(spec: ModifierSpec | null, text: string): string {
  const n = Number(text)
  if (spec?.pct && Number.isFinite(n)) {
    const p = Math.round(n * 1000) / 10
    return `${p > 0 ? '+' : ''}${p}%`
  }
  return text
}
