import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decodeDds, decodeTga } from './dds.ts'

function putU32(buf: Uint8Array, off: number, v: number): void {
  buf[off] = v & 0xff
  buf[off + 1] = (v >> 8) & 0xff
  buf[off + 2] = (v >> 16) & 0xff
  buf[off + 3] = (v >> 24) & 0xff
}

/** 构造一个 DDS 文件（fourCC 格式） */
function makeDds(width: number, height: number, fourcc: string, data: Uint8Array, dxgi?: number): Uint8Array {
  const buf = new Uint8Array((dxgi !== undefined ? 148 : 128) + data.length)
  buf.set([0x44, 0x44, 0x53, 0x20], 0)
  putU32(buf, 4, 124) // dwSize
  putU32(buf, 8, 0x1007) // dwFlags
  putU32(buf, 12, height)
  putU32(buf, 16, width)
  putU32(buf, 76, 32) // pfSize
  putU32(buf, 80, 4) // DDPF_FOURCC
  buf.set([...fourcc].map((c) => c.charCodeAt(0)), 84)
  if (dxgi !== undefined) putU32(buf, 128, dxgi)
  buf.set(data, dxgi !== undefined ? 148 : 128)
  return buf
}

function rgb565(r: number, g: number, b: number): number {
  return ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3)
}

test('DXT1 4x4 纯色块解码', () => {
  // c0 = 红, c1 = 蓝, 索引全 0 → 全部红色不透明
  const data = new Uint8Array(8)
  const c0 = rgb565(255, 0, 0)
  const c1 = rgb565(0, 0, 255)
  data[0] = c0 & 0xff
  data[1] = c0 >> 8
  data[2] = c1 & 0xff
  data[3] = c1 >> 8
  // 索引字节 4..7 全 0
  const img = decodeDds(makeDds(4, 4, 'DXT1', data))
  assert.ok(img)
  assert.equal(img.width, 4)
  assert.equal(img.height, 4)
  for (let p = 0; p < 16; p++) {
    const o = p * 4
    assert.ok(img.data[o] > 200, `R 通道应为红色，得到 ${img.data[o]}`)
    assert.ok(img.data[o + 1] < 60)
    assert.ok(img.data[o + 2] < 60)
    assert.equal(img.data[o + 3], 255)
  }
})

test('DXT5 显式 alpha 端点', () => {
  const data = new Uint8Array(16)
  // alpha: a0 = 0, a1 = 255，索引全 0 → 全透明（alpha 0）
  data[0] = 0
  data[1] = 255
  // 颜色：同 DXT1 红色
  const c0 = rgb565(255, 0, 0)
  const c1 = rgb565(255, 0, 0)
  data[8] = c0 & 0xff
  data[9] = c0 >> 8
  data[10] = c1 & 0xff
  data[11] = c1 >> 8
  const img = decodeDds(makeDds(4, 4, 'DXT5', data))
  assert.ok(img)
  for (let p = 0; p < 16; p++) {
    assert.equal(img.data[p * 4 + 3], 0)
  }
})

test('DX10 头 BC1 解码', () => {
  const data = new Uint8Array(8)
  const c0 = rgb565(0, 255, 0)
  const c1 = rgb565(0, 255, 0)
  data[0] = c0 & 0xff
  data[1] = c0 >> 8
  data[2] = c1 & 0xff
  data[3] = c1 >> 8
  const img = decodeDds(makeDds(4, 4, 'DX10', data, 71)) // BC1_UNORM
  assert.ok(img)
  assert.ok(img.data[1] > 200) // 绿色
  assert.ok(img.data[0] < 60)
})

test('未压缩 RGBA（掩码识别）', () => {
  // 2x2，像素按 R,G,B,A 字节序（R8G8B8A8）
  const px = new Uint8Array([
    255, 0, 0, 255,
    0, 255, 0, 128,
    0, 0, 255, 255,
    10, 20, 30, 40
  ])
  const buf = new Uint8Array(128 + px.length)
  buf.set([0x44, 0x44, 0x53, 0x20], 0)
  putU32(buf, 4, 124)
  putU32(buf, 12, 2)
  putU32(buf, 16, 2)
  putU32(buf, 76, 32)
  putU32(buf, 88, 32) // rgbBitCount
  putU32(buf, 92, 0x000000ff) // R
  putU32(buf, 96, 0x0000ff00) // G
  putU32(buf, 100, 0x00ff0000) // B
  putU32(buf, 104, 0xff000000) // A
  buf.set(px, 128)
  const img = decodeDds(buf)
  assert.ok(img)
  assert.deepEqual([...img.data], [...px])
})

test('损坏数据返回 null', () => {
  assert.equal(decodeDds(new Uint8Array(10)), null)
  assert.equal(decodeDds(new Uint8Array(200)), null) // 头不完整
})

test('TGA 24 位未压缩（自底向上翻转）', () => {
  // 2x2，底行在上：第一行是图像的最下面一行
  const w = 2
  const h = 2
  const buf = new Uint8Array(18 + w * h * 3)
  buf[2] = 2 // 未压缩真彩
  buf[12] = w & 0xff
  buf[13] = w >> 8
  buf[14] = h & 0xff
  buf[15] = h >> 8
  buf[16] = 24
  buf[17] = 0 // 自底向上
  // 原始数据：第一行（底行）= 红红，第二行（顶行）= 蓝蓝
  const px = buf.subarray(18)
  for (const [i, c] of [255, 0, 0, 255, 0, 0, 0, 0, 255, 0, 0, 255].entries()) px[i] = c
  const img = decodeTga(buf)
  assert.ok(img)
  // 翻转后：输出第 0 行（顶部）应是蓝色
  assert.deepEqual([...img.data.slice(0, 3)], [0, 0, 255])
  assert.equal(img.data[3], 255)
  // 输出第 1 行（底部，字节偏移 = 1 行 × 2 像素 × 4 通道）应是红色
  assert.deepEqual([...img.data.slice(8, 11)], [255, 0, 0])
})
