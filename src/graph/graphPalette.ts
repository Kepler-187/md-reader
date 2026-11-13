/**
 * 节点配色。
 *
 * 直接移植 @veewo/mechanics 的 forceNodePalette（src/web/canvas.mjs）：把作者给的
 * 节点色转成一组「静止柔和 / 聚焦饱和 / 三档明度」的颜色。这里不另起一套色板——
 * 4320 那个工具里的观感就是这套算法给的。
 */

const forcePaletteCache = new Map<string, ReturnType<typeof buildPalette>>()

function buildPalette(color?: string | null) {
  const key = typeof color === 'string' && /^#[0-9a-f]{6}$/iu.test(color) ? color.toLowerCase() : ''
  let hue = 160
  let saturation = 0.26
  if (key) {
    const [r, g, b] = [1, 3, 5].map((index) => parseInt(key.slice(index, index + 2), 16) / 255)
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const delta = max - min
    const lightness = (max + min) / 2
    if (delta > 0.004) {
      hue =
        (max === r
          ? ((g - b) / delta + 6) % 6
          : max === g
            ? (b - r) / delta + 2
            : (r - g) / delta + 4) * 60
      saturation = Math.max(0.24, Math.min(0.5, (delta / (1 - Math.abs(2 * lightness - 1))) * 0.6))
    } else {
      saturation = 0.04
    }
  }
  const hsl = (s: number, l: number) =>
    `hsl(${Math.round(hue)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`
  return {
    fill: hsl(saturation, 0.8),
    stroke: hsl(saturation * 0.9, 0.6),
    vivid: hsl(Math.min(0.62, saturation + 0.2), 0.52),
    soft: hsl(saturation * 0.85, 0.86),
    softStroke: hsl(saturation * 0.8, 0.68),
    secondary: hsl(Math.min(0.58, saturation + 0.1), 0.68),
    secondaryStroke: hsl(Math.min(0.6, saturation + 0.12), 0.44),
    core: hsl(Math.min(0.62, saturation + 0.18), 0.56),
    coreStroke: hsl(Math.min(0.64, saturation + 0.2), 0.34),
    halo: hsl(Math.min(0.62, saturation + 0.18), 0.6),
  }
}

export function forceNodePalette(color?: string | null) {
  const key = typeof color === 'string' && /^#[0-9a-f]{6}$/iu.test(color) ? color.toLowerCase() : ''
  let palette = forcePaletteCache.get(key)
  if (!palette) {
    palette = buildPalette(key)
    forcePaletteCache.set(key, palette)
  }
  return palette
}

/** 静止连线统一中性灰（mechanics 的 FORCE_EDGE_REST） */
export const FORCE_EDGE_REST = 'rgb(60,66,78)'

/** 关系类型色（mechanics 的 FORCE_RELATION_COLORS，这里只用到 reference） */
export const FORCE_RELATION_COLORS: Record<string, string> = {
  reference: '#328577',
}

/** 与 mechanics 的 hexAlpha 同式：把两色按比例混合 */
export function hexAlpha(color: string, amount: number, base: string): string {
  const mix = (index: number, from: string) =>
    Math.round(
      parseInt(from.slice(index, index + 2), 16) * (1 - amount) +
        parseInt(color.slice(index, index + 2), 16) * amount,
    )
  return `rgb(${mix(1, base)},${mix(3, base)},${mix(5, base)})`
}
