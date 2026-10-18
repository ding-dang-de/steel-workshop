import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runModChecks } from './checks.ts'
import type { CheckIssue } from './checks.ts'

/** 合成小模组：覆盖全部检查项 */
function sampleMod(): { rel: string; source: string }[] {
  return [
    {
      rel: 'common/national_focus/focus.txt',
      source: `focus_tree = {
\tid = test_tree

\tFOC_A = {
\t\tx = 0
\t\ty = 0
\t\ticon = GFX_focus_ok
\t\tcost = 10
\t\tcompletion_reward = {
\t\t\tfire_events = { EV.1 EV.99 }
\t\t}
\t}
\tFOC_B = {
\t\tx = 1
\t\ty = 0
\t\tcost = 10
\t}
}
`
    },
    {
      rel: 'events/test_events.txt',
      source: `add_namespace = test_ns

country_event = {
\tid = EV.1
\ttitle = "EV.1.t"
\tdesc = "EV.1.d"
\tpicture = GFX_ev_pic
}
`
    },
    {
      rel: 'common/decisions/test_decisions.txt',
      source: `DEC_CAT = {
\tDEC_A = {
\t\ticon = GFX_decision_missing
\t\tcost = 10
\t}
\tDEC_GAME = {
\t\ticon = GFX_GAME_ONLY
\t}
}
`
    },
    {
      rel: 'common/ideas/test_ideas.txt',
      source: `ideas = {
\tcountry = {
\t\tIDEA_A = {
\t\t\tpicture = "GFX_idea_missing"
\t\t}
\t\tIDEA_B = {
\t\t\tpicture = GFX_focus_ok
\t\t}
\t}
}
`
    },
    {
      rel: 'common/country_leader/test_traits.txt',
      source: `leader_traits = {
\tTR_A = {
\t\trandom = no
\t\tstability_factor = 0.1
\t}
}
`
    },
    {
      rel: 'common/characters/test_chars.txt',
      source: `characters = {
\tCH_1 = {
\t\tname = "CH_NAME_MISSING"
\t\tportraits = {
\t\t\tcivilian = {
\t\t\t\tlarge = "GFX_portrait_missing"
\t\t\t}
\t\t}
\t\tcountry_leader = {
\t\t\tideology = leninism
\t\t}
\t}
}
`
    },
    {
      rel: 'interface/a.gfx',
      source: `spriteTypes = {
\tspriteType = {
\t\tname = "GFX_focus_ok"
\t\ttexturefile = "gfx/a.dds"
\t}
}
`
    },
    {
      rel: 'interface/b.gfx',
      source: `spriteTypes = {
\tspriteType = {
\t\tname = "GFX_focus_ok"
\t\ttexturefile = "gfx/b.dds"
\t}
\tspriteType = {
\t\tname = "GFX_ev_pic"
\t\ttexturefile = "gfx/ev.dds"
\t}
}
`
    },
    {
      rel: 'localisation/simp_chinese/test_l_simp_chinese.yml',
      source: `l_simp_chinese:
 FOC_A:0 "甲"
 FOC_A_desc:0 "甲描述"
 EV.1.t:0 "标题"
 EV.1.d:0 "描述"
 IDEA_A:0 "精神甲"
 IDEA_B:0 "精神乙"
 IDEA_B_desc:0 "乙描述"
 CH_1:0 "人物一"
`
    }
  ]
}

const gameGfx = new Set(['GFX_GAME_ONLY'])

test('缺失本地化键：国策/决议/精神/特质/人物全覆盖', () => {
  const issues = runModChecks({ files: sampleMod(), gameGfxNames: gameGfx })
  const loc = issues.filter((i) => i.kind === 'loc-missing').map((i) => i.subject)
  assert.deepEqual(loc, [
    'CH_NAME_MISSING',
    'TR_A',
    'TR_A_desc',
    'DEC_A',
    'DEC_A_desc',
    'DEC_GAME',
    'DEC_GAME_desc',
    'IDEA_A_desc',
    'FOC_B',
    'FOC_B_desc'
  ])
})

test('GFX 未定义：带引号/裸值、模组与游戏定义都不误报', () => {
  const issues = runModChecks({ files: sampleMod(), gameGfxNames: gameGfx })
  const gfx = issues.filter((i) => i.kind === 'gfx-undefined')
  assert.deepEqual(
    gfx.map((i) => i.subject),
    ['GFX_portrait_missing', 'GFX_decision_missing', 'GFX_idea_missing']
  )
  // 带引号的 subject 已去引号
  assert.ok(gfx.every((i) => !i.subject.includes('"')))
  // 国策图标 GFX_focus_ok（模组定义）与决议 GFX_GAME_ONLY（游戏定义）不报
  assert.ok(gfx.every((i) => i.subject !== 'GFX_focus_ok' && i.subject !== 'GFX_GAME_ONLY'))
  assert.equal(gfx[2].file, 'common/ideas/test_ideas.txt')
})

test('GFX 跨文件重复定义', () => {
  const issues = runModChecks({ files: sampleMod(), gameGfxNames: gameGfx })
  const dups = issues.filter((i) => i.kind === 'gfx-duplicate')
  assert.equal(dups.length, 1)
  assert.equal(dups[0].subject, 'GFX_focus_ok')
  assert.equal(dups[0].file, 'interface/b.gfx')
  assert.ok(dups[0].message.includes('interface/a.gfx') && dups[0].message.includes('interface/b.gfx'))
})

test('事件不存在：EV.99 报、EV.1 不报（先收集事件 id）', () => {
  const issues = runModChecks({ files: sampleMod(), gameGfxNames: gameGfx })
  const ev = issues.filter((i) => i.kind === 'event-missing')
  assert.deepEqual(
    ev.map((i) => i.subject),
    ['EV.99']
  )
  assert.equal(ev[0].file, 'common/national_focus/focus.txt')
})

test('无游戏 GFX 集合时只对照模组定义（GFX_GAME_ONLY 报未定义）', () => {
  const issues = runModChecks({ files: sampleMod() })
  const gfx = issues.filter((i) => i.kind === 'gfx-undefined').map((i) => i.subject)
  assert.ok(gfx.includes('GFX_GAME_ONLY'))
})

test('结果按类别排序；空模组返回空数组', () => {
  const issues = runModChecks({ files: sampleMod(), gameGfxNames: gameGfx })
  const order = ['loc-missing', 'gfx-undefined', 'gfx-duplicate', 'event-missing']
  const kinds = issues.map((i) => i.kind)
  const idx = kinds.map((k) => order.indexOf(k))
  for (let i = 1; i < idx.length; i++) assert.ok(idx[i] >= idx[i - 1])
  assert.deepEqual(runModChecks({ files: [] }), [])
})

test('解析失败的文件不产生任何问题', () => {
  const bad: CheckIssue[] = runModChecks({
    files: [
      { rel: 'common/ideas/broken.txt', source: 'ideas = {' },
      { rel: 'localisation/simp_chinese/broken.yml', source: '{{{' }
    ]
  })
  assert.deepEqual(bad, [])
})
