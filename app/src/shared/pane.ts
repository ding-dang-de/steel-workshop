/** 双栏分屏：左栏占双栏区宽度的比例（拖动分隔条调整，写进设置持久化） */

export const PANE_SPLIT_MIN = 0.2
export const PANE_SPLIT_MAX = 0.8
export const PANE_SPLIT_DEFAULT = 0.5

/** 把任意数值夹到 [PANE_SPLIT_MIN, PANE_SPLIT_MAX]（NaN 等非法值回默认） */
export function clampPaneSplit(v: number): number {
  if (!Number.isFinite(v)) return PANE_SPLIT_DEFAULT
  return Math.min(PANE_SPLIT_MAX, Math.max(PANE_SPLIT_MIN, v))
}
