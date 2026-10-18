/**
 * DDS（DirectDraw Surface）与 TGA 解码器 —— 用于国策图标缩略图预览
 *
 * HOI4 的图标贴图绝大多数是 DDS（DXT1/DXT3/DXT5 或未压缩 RGBA），
 * 少量模组使用 TGA。这里实现主流的几种格式，够图标预览用：
 * - DXT1 (BC1) / DXT3 (BC2) / DXT5 (BC3)，含 DX10 头
 * - 未压缩的 RGBA/BGRA/ARGB（通过像素格式掩码识别）
 * - TGA：未压缩与 RLE 的 15/16/24/32 位真彩
 *
 * 输出统一为 RGBA8（Uint8Array，长度 = 宽 × 高 × 4）。
 */

export interface DecodedImage {
  width: number
  height: number
  /** RGBA8 像素数据 */
  data: Uint8Array
}

function u32(d: Uint8Array, off: number): number {
  return d[off] | (d[off + 1] << 8) | (d[off + 2] << 16) | (d[off + 3] << 24)
}

function fourCC(d: Uint8Array, off: number): string {
  return String.fromCharCode(d[off], d[off + 1], d[off + 2], d[off + 3])
}

/** 解码 DDS 文件；失败返回 null */
export function decodeDds(buf: Uint8Array): DecodedImage | null {
  try {
    if (buf.length < 128 || fourCC(buf, 0) !== 'DDS ') return null
    const width = u32(buf, 16)
    const height = u32(buf, 12)
    if (width <= 0 || height <= 0 || width > 8192 || height > 8192) return null
    const pfFlags = u32(buf, 80)
    const fourcc = fourCC(buf, 84)
    const rgbBits = u32(buf, 88)
    const rMask = u32(buf, 92)
    const gMask = u32(buf, 96)
    const bMask = u32(buf, 100)
    const aMask = u32(buf, 104)

    // DX10 扩展头
    if (fourcc === 'DX10') {
      const dxgi = u32(buf, 128)
      const data = buf.subarray(148)
      switch (dxgi) {
        case 71: // BC1_UNORM
          return decodeBc(data, width, height, 1)
        case 74: // BC2_UNORM
          return decodeBc(data, width, height, 2)
        case 77: // BC3_UNORM
          return decodeBc(data, width, height, 3)
        case 28: // R8G8B8A8_UNORM
          return unpackUncompressed(data, width, height, 0x000000ff, 0x0000ff00, 0x00ff0000, 0xff000000)
        case 87: // B8G8R8A8_UNORM
          return unpackUncompressed(data, width, height, 0x00ff0000, 0x0000ff00, 0x000000ff, 0xff000000)
        default:
          return null
      }
    }

    const data = buf.subarray(128)
    if (fourcc === 'DXT1') return decodeBc(data, width, height, 1)
    if (fourcc === 'DXT3') return decodeBc(data, width, height, 2)
    if (fourcc === 'DXT5') return decodeBc(data, width, height, 3)
    // 未压缩格式（通过掩码识别像素布局）
    if ((pfFlags & 0x4) === 0 && rgbBits >= 24) {
      return unpackUncompressed(data, width, height, rMask, gMask, bMask, aMask)
    }
    return null
  } catch {
    return null
  }
}

/** 按掩码从 32 位像素提取通道 */
function unpackUncompressed(
  data: Uint8Array,
  width: number,
  height: number,
  rMask: number,
  gMask: number,
  bMask: number,
  aMask: number
): DecodedImage | null {
  const need = width * height * 4
  if (data.length < need) return null
  const out = new Uint8Array(need)
  const shift = (mask: number): number => {
    let s = 0
    while (mask && (mask & 1) === 0) {
      mask >>>= 1
      s++
    }
    return s
  }
  const rShift = shift(rMask)
  const gShift = shift(gMask)
  const bShift = shift(bMask)
  const aShift = shift(aMask)
  for (let i = 0; i < width * height; i++) {
    const v = u32(data, i * 4)
    const o = i * 4
    out[o] = (v & rMask) >>> rShift
    out[o + 1] = (v & gMask) >>> gShift
    out[o + 2] = (v & bMask) >>> bShift
    out[o + 3] = aMask ? (v & aMask) >>> aShift : 255
  }
  return { width, height, data: out }
}

/** 解码 BC1/BC2/BC3 压缩块 */
function decodeBc(data: Uint8Array, width: number, height: number, bc: 1 | 2 | 3): DecodedImage | null {
  const blocksX = Math.max(1, Math.ceil(width / 4))
  const blocksY = Math.max(1, Math.ceil(height / 4))
  const blockSize = bc === 1 ? 8 : 16
  if (data.length < blocksX * blocksY * blockSize) return null
  const out = new Uint8Array(width * height * 4)
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const off = (by * blocksX + bx) * blockSize
      // 颜色部分：DXT1 从 0 开始，DXT3/5 从 8 开始
      const colorOff = bc === 1 ? 0 : 8
      const c0 = data[off + colorOff] | (data[off + colorOff + 1] << 8)
      const c1 = data[off + colorOff + 2] | (data[off + colorOff + 3] << 8)
      const colors: [number, number, number, number][] = []
      colors.push(rgb565(c0, 255))
      colors.push(rgb565(c1, 255))
      if (c0 > c1) {
        colors.push(interp(colors[0], colors[1], 2, 1, 255))
        colors.push(interp(colors[0], colors[1], 1, 2, 255))
      } else {
        colors.push(interp(colors[0], colors[1], 1, 1, 255))
        colors.push(interp(colors[0], colors[1], 1, 1, 0)) // 透明
      }
      // 2 位索引：每字节 4 个像素，低位在前
      for (let p = 0; p < 16; p++) {
        const byte = data[off + colorOff + 4 + (p >> 2)]
        const idx = (byte >> ((p & 3) * 2)) & 3
        const px = bx * 4 + (p & 3)
        const py = by * 4 + (p >> 2)
        if (px >= width || py >= height) continue
        const o = (py * width + px) * 4
        out[o] = colors[idx][0]
        out[o + 1] = colors[idx][1]
        out[o + 2] = colors[idx][2]
        out[o + 3] = colors[idx][3]
      }
      // 显式/插值 alpha
      if (bc === 2) {
        for (let p = 0; p < 16; p++) {
          const byte = data[off + (p >> 1)]
          const a = (p & 1) === 0 ? byte & 0xf : byte >> 4
          const px = bx * 4 + (p & 3)
          const py = by * 4 + (p >> 2)
          if (px >= width || py >= height) continue
          out[(py * width + px) * 4 + 3] = a * 17
        }
      } else if (bc === 3) {
        const a0 = data[off]
        const a1 = data[off + 1]
        // 6 字节 3 位索引（小端位流）
        const alphas = [a0, a1]
        if (a0 > a1) {
          for (let k = 1; k <= 6; k++) alphas.push(Math.round(((6 - k) * a0 + k * a1) / 6))
        } else {
          for (let k = 1; k <= 4; k++) alphas.push(Math.round(((4 - k) * a0 + k * a1) / 4))
          alphas.push(0, 255)
        }
        for (let p = 0; p < 16; p++) {
          const bitPos = p * 3
          const byte0 = data[off + 2 + (bitPos >> 3)]
          const byte1 = data[off + 2 + (bitPos >> 3) + 1]
          const shift = bitPos & 7
          const idx = ((byte0 >> shift) | (byte1 << (8 - shift))) & 0x7
          const px = bx * 4 + (p & 3)
          const py = by * 4 + (p >> 2)
          if (px >= width || py >= height) continue
          out[(py * width + px) * 4 + 3] = alphas[idx]
        }
      }
    }
  }
  return { width, height, data: out }
}

function rgb565(v: number, a: number): [number, number, number, number] {
  const r = (v >> 11) & 0x1f
  const g = (v >> 5) & 0x3f
  const b = v & 0x1f
  return [(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2), a]
}

function interp(
  c0: [number, number, number, number],
  c1: [number, number, number, number],
  w0: number,
  w1: number,
  a: number
): [number, number, number, number] {
  return [
    Math.round((c0[0] * w0 + c1[0] * w1) / 3),
    Math.round((c0[1] * w0 + c1[1] * w1) / 3),
    Math.round((c0[2] * w0 + c1[2] * w1) / 3),
    a
  ]
}

/** 解码 TGA 文件（未压缩与 RLE 真彩）；失败返回 null */
export function decodeTga(buf: Uint8Array): DecodedImage | null {
  try {
    if (buf.length < 18) return null
    const idLen = buf[0]
    const colorMapType = buf[1]
    const imageType = buf[2]
    const width = buf[12] | (buf[13] << 8)
    const height = buf[14] | (buf[15] << 8)
    const bpp = buf[16]
    const desc = buf[17]
    if (width <= 0 || height <= 0 || width > 8192 || height > 8192) return null
    // 描述符第 5 位：1 = 自顶向下，0 = 自底向上（TGA 默认）
    const topDown = (desc & 0x20) !== 0
    let off = 18 + idLen
    if (colorMapType !== 0) {
      const cmLen = buf[5] | (buf[6] << 8)
      const cmBpp = buf[7]
      off += cmLen * Math.ceil(cmBpp / 8)
    }
    const bytesPerPixel = Math.ceil(bpp / 8)
    const out = new Uint8Array(width * height * 4)
    if (imageType === 2) {
      // 未压缩真彩
      if (buf.length < off + width * height * bytesPerPixel) return null
      let i = off
      for (let p = 0; p < width * height; p++) {
        writePixel(out, p, buf, i, bpp)
        i += bytesPerPixel
      }
    } else if (imageType === 10) {
      // RLE 真彩
      let p = 0
      while (p < width * height && off < buf.length) {
        const h = buf[off++]
        const count = (h & 0x7f) + 1
        if (h & 0x80) {
          for (let k = 0; k < count && p < width * height; k++, p++) {
            writePixel(out, p, buf, off, bpp)
          }
          off += bytesPerPixel
        } else {
          for (let k = 0; k < count && p < width * height; k++, p++) {
            writePixel(out, p, buf, off, bpp)
            off += bytesPerPixel
          }
        }
      }
    } else {
      return null
    }
    // TGA 默认自底向上，需要翻转
    if (!topDown) {
      const row = new Uint8Array(width * 4)
      for (let y = 0; y < height >> 1; y++) {
        const a = y * width * 4
        const b = (height - 1 - y) * width * 4
        row.set(out.subarray(a, a + width * 4))
        out.copyWithin(a, b, b + width * 4)
        out.set(row, b)
      }
    }
    return { width, height, data: out }
  } catch {
    return null
  }
}

function writePixel(out: Uint8Array, p: number, buf: Uint8Array, off: number, bpp: number): void {
  const o = p * 4
  if (bpp === 32) {
    out[o] = buf[off]
    out[o + 1] = buf[off + 1]
    out[o + 2] = buf[off + 2]
    out[o + 3] = buf[off + 3]
  } else if (bpp === 24) {
    out[o] = buf[off]
    out[o + 1] = buf[off + 1]
    out[o + 2] = buf[off + 2]
    out[o + 3] = 255
  } else {
    // 16 位（A1 R5 G5 B5 或 R5 G6 B5）
    const v = buf[off] | (buf[off + 1] << 8)
    out[o] = ((v >> 10) & 0x1f) << 3
    out[o + 1] = ((v >> 5) & 0x1f) << 3
    out[o + 2] = (v & 0x1f) << 3
    out[o + 3] = bpp === 15 || (v & 0x8000) ? 255 : 0
  }
}
