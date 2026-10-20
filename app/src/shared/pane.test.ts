import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clampPaneSplit, PANE_SPLIT_MIN, PANE_SPLIT_MAX, PANE_SPLIT_DEFAULT } from './pane.ts'

test('默认值在合法范围内', () => {
  assert.ok(PANE_SPLIT_DEFAULT >= PANE_SPLIT_MIN && PANE_SPLIT_DEFAULT <= PANE_SPLIT_MAX)
  assert.ok(PANE_SPLIT_MIN < PANE_SPLIT_MAX)
})

test('范围内数值原样返回', () => {
  assert.equal(clampPaneSplit(0.35), 0.35)
  assert.equal(clampPaneSplit(PANE_SPLIT_MIN), PANE_SPLIT_MIN)
  assert.equal(clampPaneSplit(PANE_SPLIT_MAX), PANE_SPLIT_MAX)
})

test('越界数值夹到边界', () => {
  assert.equal(clampPaneSplit(0), PANE_SPLIT_MIN)
  assert.equal(clampPaneSplit(-1), PANE_SPLIT_MIN)
  assert.equal(clampPaneSplit(1), PANE_SPLIT_MAX)
  assert.equal(clampPaneSplit(2.5), PANE_SPLIT_MAX)
})

test('非法数值回默认', () => {
  assert.equal(clampPaneSplit(Number.NaN), PANE_SPLIT_DEFAULT)
  assert.equal(clampPaneSplit(Infinity), PANE_SPLIT_DEFAULT)
  assert.equal(clampPaneSplit(-Infinity), PANE_SPLIT_DEFAULT)
})
