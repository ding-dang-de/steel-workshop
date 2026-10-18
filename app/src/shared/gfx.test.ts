import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadGfx, extractGfxSpriteNames } from './gfx.ts'
import { parseFile, serialize } from './clausewitz.ts'

/** 用户模组 paris_commune 的真实头像 .gfx（interface/fra_cachin_portrait.gfx） */
const REAL = `spriteTypes = {
\tspriteType = {
\t\tname = "GFX_portrait_FRA_marcel_cachin_large"
\t\ttexturefile = "gfx/leaders/FRA/portrait_FRA_marcel_cachin.dds"
\t}
}
`

test('真实 fra_cachin_portrait.gfx 往返字节一致且解析出 1 个精灵', () => {
  const { file } = parseFile(REAL, 'txt')
  assert.ok(file)
  assert.equal(serialize(file), REAL)
  const model = loadGfx(REAL)
  assert.ok(model)
  assert.equal(model.errors.length, 0)
  assert.equal(model.sprites.length, 1)
  assert.equal(model.sprites[0].name, 'GFX_portrait_FRA_marcel_cachin_large')
  assert.equal(model.sprites[0].tex, 'gfx/leaders/FRA/portrait_FRA_marcel_cachin.dds')
  assert.deepEqual(model.sprites[0].extra, [])
  assert.equal(model.duplicates.size, 0)
  assert.deepEqual(extractGfxSpriteNames(REAL), ['GFX_portrait_FRA_marcel_cachin_large'])
})

/** 大小写键名 + 多个精灵 + 额外标量字段 + 重复名（focusIcon.gfx 的真实风格） */
const MULTI = `spriteTypes = {
	SpriteType = {
		name = "GFX_focus_nov_death"
		texturefile = "gfx/interface/goals/focus_nov_death.dds"
		noOfFrames = 1
	}
	spriteType = {
		name = "GFX_NOV_Death"
		texturefile = "gfx/interface/goals/nov_death.dds"
	}
	SpriteType = {
		name = "GFX_NOV_Death"
		texturefile = "gfx/interface/goals/nov_death_shine.dds"
		effectFile = "gfx/FX/buttonstate.lua"
	}
}
`

test('大写 SpriteType 键名、额外字段、重复名检测', () => {
  const model = loadGfx(MULTI)
  assert.ok(model)
  assert.equal(model.errors.length, 0)
  assert.equal(model.sprites.length, 3)
  assert.deepEqual(model.sprites.map((s) => s.name), [
    'GFX_focus_nov_death',
    'GFX_NOV_Death',
    'GFX_NOV_Death'
  ])
  assert.deepEqual(model.sprites[0].extra, [['noOfFrames', '1']])
  assert.deepEqual(model.sprites[2].extra, [['effectFile', '"gfx/FX/buttonstate.lua"']])
  // 重复名出现两次（大小写敏感比较，与游戏一致）；唯一名不在 map 里
  assert.equal(model.duplicates.get('GFX_NOV_Death'), 2)
  assert.equal(model.duplicates.has('GFX_focus_nov_death'), false)
})

test('无 spriteTypes 块返回空模型而非 null', () => {
  const model = loadGfx(`someOther = {\n\tx = 1\n}\n`)
  assert.ok(model)
  assert.equal(model.sprites.length, 0)
  assert.equal(model.duplicates.size, 0)
})

test('缺 name 或缺 texturefile 的条目跳过', () => {
  const model = loadGfx(`spriteTypes = {
\tspriteType = {
\t\tname = "GFX_A"
\t}
\tspriteType = {
\t\ttexturefile = "gfx/a.dds"
\t}
\tspriteType = {
\t\tname = "GFX_B"
\t\ttexturefile = "gfx/b.dds"
\t}
}
`)
  assert.ok(model)
  assert.deepEqual(model.sprites.map((s) => s.name), ['GFX_B'])
})

test('语法错误时 loadGfx 仍返回模型但带 errors、extractGfxSpriteNames 返回空数组', () => {
  const model = loadGfx('spriteTypes = {')
  assert.ok(model)
  assert.equal(model.sprites.length, 0)
  assert.ok(model.errors.length > 0)
  assert.deepEqual(extractGfxSpriteNames('{{{'), [])
})
