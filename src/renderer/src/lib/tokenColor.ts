/**
 * A theme token (`--primary`, `--border` …) as `rgb(r, g, b)`, for drawing
 * code that can't read CSS variables — a canvas, cytoscape. The tokens are
 * oklch(), which those don't parse, so the colour is painted once and read
 * back, its own transparency kept (`rgba()`); `alpha` (0–1) replaces that.
 */
export function tokenColor(name: string, alpha?: number): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  if (!ctx || !value) return alpha === undefined ? 'rgb(136, 136, 136)' : `rgba(136, 136, 136, ${alpha})`
  ctx.fillStyle = value
  ctx.fillRect(0, 0, 1, 1)
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
  const opacity = alpha ?? a / 255
  return opacity >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${+opacity.toFixed(3)})`
}
