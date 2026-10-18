import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  loadCharacters,
  saveCharacters,
  buildCharacters,
  setCharacterId,
  setName,
  setPortrait,
  addPortraitGroup,
  setRoleField,
  getRoleField,
  getTraitList,
  addTrait,
  removeTrait,
  getCharacterCondBlock,
  setCharacterCondBlock,
  addRoleBlock,
  removeRoleBlock,
  addCharacter,
  deleteCharacter,
  suggestCharacterId,
  extractCharacterIds,
  createCharactersFile
} from './characters.ts'
import { parseFile, serialize } from './clausewitz.ts'

/** 用户模组 paris_commune 的真实人物文件（common/characters/FRA_commune.txt，tab 缩进） */
const REAL = `characters = {
\t# 马赛尔·加香 —— 法国共产党领袖
\tFRA_Marcel_Cachin = {
\t\tname = FRA_Marcel_Cachin
\t\tportraits = {
\t\t\tcivilian = {
\t\t\t\tlarge = "GFX_portrait_FRA_marcel_cachin_large"
\t\t\t}
\t\t}
\t\tcountry_leader = {
\t\t\tideology = leninism
\t\t\ttraits = { FRA_marcel_cachin_trait }
\t\t\texpire = "1965.1.1.1"
\t\t}
\t}

\t# 法兰西革命委员会 —— 过渡政权集体领导（头像借用原版最高苏维埃）
\tFRA_revolutionary_committee = {
\t\tname = FRA_revolutionary_committee
\t\tportraits = {
\t\t\tcivilian = {
\t\t\t\tlarge = "GFX_portrait_SOV_supreme_soviet"
\t\t\t}
\t\t}
\t\tcountry_leader = {
\t\t\tideology = leninism
\t\t\ttraits = { FRA_revolutionary_committee_trait }
\t\t\texpire = "1965.1.1.1"
\t\t}
\t}

\t# 米哈伊尔·图哈切夫斯基 —— 红色拿破仑（属性与原版苏联元帅相同）
\tFRA_mikhail_tukhachevsky = {
\t\tname = SOV_mikhail_tukhachevsky
\t\tportraits = {
\t\t\tarmy = {
\t\t\t\tsmall = "GFX_idea_mikhail_tukhachevsky"
\t\t\t\tlarge = GFX_portrait_SOV_mikhail_tukhachevsky
\t\t\t}
\t\t}
\t\tfield_marshal = {
\t\t\ttraits = { brilliant_strategist career_officer trait_reckless infantry_officer offensive_doctrine }
\t\t\tskill = 4
\t\t\tattack_skill = 3
\t\t\tdefense_skill = 4
\t\t\tplanning_skill = 4
\t\t\tlogistics_skill = 2
\t\t}
\t}

\t# 莫里斯·多列士 —— 政治顾问（完成 FRA_appoint_Thorez 后可启用）
\tFRA_maurice_thorez_pc = {
\t\tname = FRA_maurice_thorez
\t\tportraits = {
\t\t\tarmy = {
\t\t\t\tsmall = "GFX_idea_maurice_thorez"
\t\t\t}
\t\t\tcivilian = {
\t\t\t\tlarge = "GFX_portrait_fra_maurice_thorez"
\t\t\t}
\t\t}
\t\tadvisor = {
\t\t\tslot = political_advisor
\t\t\tidea_token = FRA_maurice_thorez_advisor
\t\t\tallowed = {
\t\t\t\toriginal_tag = FRA
\t\t\t}
\t\t\tavailable = {
\t\t\t\thas_completed_focus = FRA_appoint_Thorez
\t\t\t}
\t\t\ttraits = {
\t\t\t\tFRA_maurice_thorez_trait
\t\t\t}
\t\t\tai_will_do = {
\t\t\t\tfactor = 0
\t\t\t}
\t\t}
\t}
}
`

test('人物文件：解析与序列化往返逐字节一致', () => {
  const parsed = parseFile(REAL, 'txt').file
  assert.ok(parsed)
  assert.equal(serialize(parsed), REAL)
})

test('loadCharacters 读出 4 个角色与职位/肖像', () => {
  const model = loadCharacters(REAL)
  assert.ok(model)
  const cs = model.characters
  assert.deepEqual(
    cs.map((x) => x.id),
    ['FRA_Marcel_Cachin', 'FRA_revolutionary_committee', 'FRA_mikhail_tukhachevsky', 'FRA_maurice_thorez_pc']
  )
  assert.deepEqual(
    cs.map((x) => x.role),
    ['country_leader', 'country_leader', 'field_marshal', 'advisor']
  )
  assert.equal(cs[0].name, 'FRA_Marcel_Cachin')
  assert.deepEqual(cs[2].portraits, [
    { scope: 'army', small: '"GFX_idea_mikhail_tukhachevsky"', large: 'GFX_portrait_SOV_mikhail_tukhachevsky' }
  ])
  assert.deepEqual(cs[3].portraits.map((p) => p.scope), ['army', 'civilian'])
})

test('改肖像：删除槽位清空组、再赋值原地恢复逐字节', () => {
  const model = loadCharacters(REAL)
  assert.ok(model)
  const m = model.characters[3].entry // 多列士：army.small + civilian.large
  setPortrait(m, 'civilian', 'large', null)
  let out = saveCharacters(model)
  assert.ok(!out.includes('GFX_portrait_fra_maurice_thorez'), '大肖像删除')
  assert.equal(out.split('civilian = {').length - 1, 2, '多列士的 civilian 组随最后一张肖像一起删除（另两个角色各留一组）')
  assert.ok(out.includes('GFX_idea_maurice_thorez'), 'army 组不动')
  // 原地恢复（组块与标量都走 findDeletedEntry）
  setPortrait(m, 'civilian', 'large', 'GFX_portrait_fra_maurice_thorez')
  assert.equal(saveCharacters(model), REAL)
})

test('改肖像：新组（navy）与引号风格保持；空组删除', () => {
  const model = loadCharacters(REAL)
  assert.ok(model)
  const m = model.characters[2].entry // 图哈切夫斯基：army.small + army.large
  setPortrait(m, 'navy', 'small', 'GFX_idea_tuh_navy')
  let out = saveCharacters(model)
  assert.ok(out.includes('navy = {'))
  assert.ok(out.includes('small = "GFX_idea_tuh_navy"'), '新增的肖像值默认带引号（GFX 引用惯例）')
  setPortrait(m, 'navy', 'small', null)
  assert.equal(saveCharacters(model), REAL)
  // addPortraitGroup：建空组（navy = { }），删空组还原
  addPortraitGroup(m, 'navy')
  out = saveCharacters(model)
  assert.ok(out.includes('navy = {'))
  setPortrait(m, 'navy', 'small', null)
  assert.equal(saveCharacters(model), REAL)
})

test('改职位字段：skill 改值+撤销字节还原；expire 保持引号', () => {
  const model = loadCharacters(REAL)
  assert.ok(model)
  const m = model.characters[2].entry
  assert.equal(getRoleField(m, 'skill'), '4')
  setRoleField(m, 'skill', '5')
  assert.ok(saveCharacters(model).includes('skill = 5'))
  setRoleField(m, 'skill', '4')
  assert.equal(saveCharacters(model), REAL)
  // 引号字段：输入不带引号也写回带引号（加香的 expire = "1965.1.1.1"）
  const leader = model.characters[0].entry
  setRoleField(leader, 'expire', '1970.1.1.1')
  assert.ok(saveCharacters(model).includes('expire = "1970.1.1.1"'))
  setRoleField(leader, 'expire', '1965.1.1.1')
  assert.equal(saveCharacters(model), REAL)
})

test('traits 裸值列表：单行追加保持单行、多行追加独占一行、删除后字节还原', () => {
  const model = loadCharacters(REAL)
  assert.ok(model)
  const marshal = model.characters[2].entry
  assert.equal(getTraitList(marshal).length, 5)
  addTrait(marshal, 'organized')
  let out = saveCharacters(model)
  assert.ok(
    out.includes('traits = { brilliant_strategist career_officer trait_reckless infantry_officer offensive_doctrine organized }')
  )
  removeTrait(marshal, 'organized')
  assert.equal(saveCharacters(model), REAL)

  // 多行列表（顾问）：新特质独占一行，缩进与文件一致（4 tab）
  const advisor = model.characters[3].entry
  addTrait(advisor, 'FRA_new_trait')
  out = saveCharacters(model)
  assert.ok(out.includes('\t\t\t\tFRA_maurice_thorez_trait\n\t\t\t\tFRA_new_trait\n\t\t\t}'))
  removeTrait(advisor, 'FRA_new_trait')
  assert.equal(saveCharacters(model), REAL)
})

test('改名/name 字段往返', () => {
  const model = loadCharacters(REAL)
  assert.ok(model)
  const m = model.characters[0].entry
  setName(m, 'FRA_Cachin_new')
  assert.ok(saveCharacters(model).includes('name = FRA_Cachin_new'))
  setName(m, 'FRA_Marcel_Cachin')
  setCharacterId(m, 'FRA_Marcel_Cachin_new')
  assert.ok(saveCharacters(model).includes('FRA_Marcel_Cachin_new = {'))
  setCharacterId(m, 'FRA_Marcel_Cachin')
  assert.equal(saveCharacters(model), REAL)
})

test('顾问 allowed/available 条件块读取与整块替换', () => {
  const model = loadCharacters(REAL)
  assert.ok(model)
  const m = model.characters[3].entry
  const allowed = getCharacterCondBlock(m, 'allowed')
  assert.ok(allowed)
  assert.equal(allowed.length, 1)
  setCharacterCondBlock(m, 'allowed', allowed)
  const avail = getCharacterCondBlock(m, 'available')
  assert.ok(avail)
  setCharacterCondBlock(m, 'available', avail)
  assert.equal(saveCharacters(model), REAL)
})

test('职位块删除与重新添加（默认字段）', () => {
  const model = loadCharacters(REAL)
  assert.ok(model)
  const ch = addCharacter(model, 'FRA_tmp')
  assert.ok(ch)
  removeRoleBlock(ch)
  assert.equal(buildCharacters(model.file)[4].role, 'none')
  const rb = addRoleBlock(ch, 'country_leader')
  assert.ok(rb)
  let out = saveCharacters(model)
  assert.ok(out.includes('ideology = neutrality'))
  removeRoleBlock(ch)
  deleteCharacter(model, 'FRA_tmp')
  assert.equal(saveCharacters(model), REAL)
})

test('新增/删除角色与 suggestCharacterId', () => {
  const model = loadCharacters(REAL)
  assert.ok(model)
  assert.equal(suggestCharacterId(model, 'FRA'), 'FRA_character_1')
  const ch = addCharacter(model, 'FRA_character_1')
  assert.ok(ch)
  assert.ok(saveCharacters(model).includes('FRA_character_1 = {'))
  assert.equal(suggestCharacterId(model, 'FRA'), 'FRA_character_2')
  deleteCharacter(model, 'FRA_character_1')
  assert.equal(saveCharacters(model), REAL)
})

test('extractCharacterIds 与 createCharactersFile 模板往返', () => {
  assert.deepEqual(extractCharacterIds(REAL), [
    'FRA_Marcel_Cachin',
    'FRA_revolutionary_committee',
    'FRA_mikhail_tukhachevsky',
    'FRA_maurice_thorez_pc'
  ])
  const text = createCharactersFile('paris_commune', '\n')
  const parsed = parseFile(text, 'txt').file
  assert.ok(parsed)
  assert.equal(serialize(parsed), text)
  const model = loadCharacters(text)
  assert.ok(model)
  assert.deepEqual(model.characters.map((x) => x.id), ['paris_commune_character_1'])
  assert.equal(model.characters[0].role, 'country_leader')
  assert.deepEqual(model.characters[0].portraits, [{ scope: 'civilian', small: null, large: '"GFX_portrait_unknown"' }])
  assert.equal(getRoleField(model.characters[0].entry, 'ideology'), 'neutrality')
  assert.deepEqual(getTraitList(model.characters[0].entry), [])
})

test('buildCharacters 每次调用重新读取（模型修改后拿到最新状态）', () => {
  const { file } = parseFile(REAL, 'txt')
  assert.ok(file)
  const first = buildCharacters(file)
  assert.equal(first.length, 4)
  addCharacter({ file, characters: first, errors: [] }, 'FRA_x')
  const second = buildCharacters(file)
  assert.equal(second.length, 5)
})
