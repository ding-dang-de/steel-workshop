import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MODIFIER_CATALOG, MOD_CAT_ZH, findModifier, suggestModifierKeys } from './modifiers.ts'

test('目录不变式：键唯一、中文说明齐全、分类合法', () => {
  const keys = MODIFIER_CATALOG.map((s) => s.key)
  assert.equal(new Set(keys).size, keys.length)
  for (const s of MODIFIER_CATALOG) {
    assert.ok(s.zh.length > 0, `${s.key} 缺中文说明`)
    assert.ok(MOD_CAT_ZH.includes(s.cat), `${s.key} 分类非法: ${s.cat}`)
  }
  assert.equal(findModifier('army_experience_gain_factor')?.zh, '陆军经验获取')
})

test('suggestModifierKeys：空输入返回空；英文前缀匹配', () => {
  assert.deepEqual(suggestModifierKeys(''), [])
  const pre = suggestModifierKeys('army_experience')
  assert.ok(pre.length > 0)
  assert.ok(pre.every((s) => s.key.toLowerCase().startsWith('army_experience')))
})

test('suggestModifierKeys：中文前缀命中（陆军经验 → army_experience_gain_factor）', () => {
  const r = suggestModifierKeys('陆军经验')
  assert.equal(r[0].key, 'army_experience_gain_factor')
  for (const s of r) assert.match(s.key, /^[A-Za-z0-9_]+$/)
})

test('suggestModifierKeys：中文说明搜索（建设 → production_speed_buildings_factor 优先）', () => {
  const r = suggestModifierKeys('建设')
  assert.equal(r[0].key, 'production_speed_buildings_factor')
})

test('suggestModifierKeys：分类名精确命中（军事 → 军事分类条目）', () => {
  const r = suggestModifierKeys('军事')
  assert.equal(r.length, 12) // limit 上限（军事分类 72 条）
  assert.equal(r[0].key, 'military_staff_cost_factor')
  assert.ok(r.every((s) => s.cat === '军事'))
})

test('suggestModifierKeys：中文无匹配返回空；limit 生效', () => {
  assert.deepEqual(suggestModifierKeys('不存在的中文修饰符'), [])
  assert.equal(suggestModifierKeys('army_', 4).length, 4)
})
