import { existsSync, readFileSync } from 'fs'
import { basename, join } from 'path'
import { scanBlocks, stripComments } from '@shared/pdx'
import { effectiveFiles } from './refdata'
import { decodeDds, encodePng } from './dds'

/**
 * Coat of arms rendering.
 *
 * A CoA definition (common/coat_of_arms/coat_of_arms) names a pattern texture,
 * up to five colors, and a list of colored emblems, each drawn one or more
 * times at instance transforms. The textures encode color zones per channel
 * (verified empirically against the game's DDS files):
 * - patterns (DXT1): red = color1, yellow = color2, white = color3, so the
 *   per-pixel weights are w3 = B, w2 = G - B, w1 = R - G.
 * - colored emblems (DXT5): the base is color1, the green channel masks in
 *   color2 and the red channel color3; blue is a shading multiplier centered
 *   at 128, alpha is the emblem's shape.
 *
 * Not implemented (unused by local-mod dynasty/house CoAs): `sub` blocks,
 * textured_emblems, title-rank frames.
 */

export type Rgb = [number, number, number]

/** A color as written in a definition: named (or colorN back-reference) or literal. */
export type RawColor = { name: string } | { value: Rgb }

export interface CoaInstance {
  x: number
  y: number
  sx: number
  sy: number
  /** degrees, visually clockwise */
  rotation: number
  /** larger = drawn further back */
  depth: number
}

export interface CoaEmblem {
  texture: string
  colors: (RawColor | null)[]
  /** pattern color zones (1-3) the emblem is restricted to; empty = everywhere */
  mask: number[]
  instances: CoaInstance[]
}

export interface CoaDef {
  pattern: string | null
  colors: (RawColor | null)[]
  emblems: CoaEmblem[]
}

export interface DecodedTexture {
  width: number
  height: number
  rgba: Uint8Array | Buffer
}

// ---------- Color parsing ----------

function hsvToRgb(h: number, s: number, v: number): Rgb {
  h = ((h % 1) + 1) % 1
  const i = Math.floor(h * 6)
  const f = h * 6 - i
  const p = v * (1 - s)
  const q = v * (1 - f * s)
  const t = v * (1 - (1 - f) * s)
  const [r, g, b] = [
    [v, t, p],
    [q, v, p],
    [p, v, t],
    [p, q, v],
    [t, p, v],
    [v, p, q]
  ][i % 6]
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)]
}

function nums(list: string): number[] {
  return list
    .trim()
    .split(/\s+/)
    .map(Number)
    .filter((n) => !Number.isNaN(n))
}

/** `rgb { 1 2 3 }`, `hsv { .1 .2 .3 }`, `hsv360 { 120 50 50 }` or a bare triple. */
export function parseColorLiteral(kind: string | undefined, list: string): Rgb | null {
  const n = nums(list)
  if (n.length < 3) return null
  if (kind === 'hsv') return hsvToRgb(n[0], n[1], n[2])
  if (kind === 'hsv360') return hsvToRgb(n[0] / 360, n[1] / 100, n[2] / 100)
  if (kind === 'rgb') return [n[0], n[1], n[2]]
  // Bare triple: floats are 0-1, anything larger means 0-255
  const scale = n.some((v) => v > 1) ? 1 : 255
  return [n[0] * scale, n[1] * scale, n[2] * scale]
}

// `colorN = <literal or name>` anywhere in (comment-stripped, block-blanked) text
const COLOR_RE =
  /(?:^|[\s{}])color([1-5])\s*=\s*(?:(rgb|hsv360|hsv)\s*\{([^}]*)\}|\{([^}]*)\}|"([^"]+)"|([A-Za-z0-9_.\-']+))/g

function scanColors(text: string): (RawColor | null)[] {
  const colors: (RawColor | null)[] = [null, null, null, null, null]
  for (const m of text.matchAll(COLOR_RE)) {
    const slot = Number(m[1]) - 1
    if (colors[slot] !== null) continue
    if (m[2] !== undefined || m[4] !== undefined) {
      const value = parseColorLiteral(m[2], m[3] ?? m[4])
      colors[slot] = value ? { value } : null
    } else {
      colors[slot] = { name: m[5] ?? m[6] }
    }
  }
  return colors
}

/**
 * Named colors from common/named_colors — entries of the top-level
 * `colors = { … }` block in each file.
 */
export function parseNamedColors(text: string): Map<string, Rgb> {
  const out = new Map<string, Rgb>()
  const stripped = stripComments(text)
  for (const block of scanBlocks(stripped)) {
    if (block.key !== 'colors') continue
    const body = stripped.slice(block.bodyStart, block.bodyEnd)
    const entry = /([A-Za-z0-9_.\-']+)\s*=\s*(?:(rgb|hsv360|hsv)\s*)?\{([^}]*)\}/g
    for (const m of body.matchAll(entry)) {
      const value = parseColorLiteral(m[2], m[3])
      if (value) out.set(m[1], value)
    }
  }
  return out
}

// ---------- Definition parsing ----------

/** Replace the given block spans with spaces so regexes only see what's left. */
function blankSpans(text: string, spans: { start: number; end: number }[]): string {
  let out = ''
  let pos = 0
  for (const s of spans.sort((a, b) => a.start - b.start)) {
    out += text.slice(pos, s.start) + ' '.repeat(s.end - s.start)
    pos = s.end
  }
  return out + text.slice(pos)
}

const DEFAULT_INSTANCE: CoaInstance = { x: 0.5, y: 0.5, sx: 1, sy: 1, rotation: 0, depth: 0 }

/**
 * A `key = value` scalar anywhere in the text — unlike scanScalars this is not
 * line-anchored, so it also reads single-line bodies holding several
 * statements. Call on block-blanked text so nested blocks can't shadow it.
 */
function lenientScalar(text: string, key: string): string | undefined {
  const m = text.match(new RegExp(`(?:^|[\\s{}])${key}\\s*=\\s*(?:"([^"]*)"|([^\\s{}"#=]+))`))
  return m ? (m[1] ?? m[2]) : undefined
}

function parseInstance(body: string): CoaInstance {
  const inst = { ...DEFAULT_INSTANCE }
  const blocks = scanBlocks(body)
  for (const block of blocks) {
    const n = nums(body.slice(block.bodyStart, block.bodyEnd))
    if (block.key === 'position' && n.length >= 2) [inst.x, inst.y] = n
    if (block.key === 'scale' && n.length >= 1) {
      inst.sx = n[0]
      inst.sy = n.length >= 2 ? n[1] : n[0]
    }
  }
  const blanked = blankSpans(body, blocks)
  const rotation = Number(lenientScalar(blanked, 'rotation'))
  const depth = Number(lenientScalar(blanked, 'depth'))
  if (!Number.isNaN(rotation)) inst.rotation = rotation
  if (!Number.isNaN(depth)) inst.depth = depth
  return inst
}

function parseEmblem(body: string): CoaEmblem | null {
  const blocks = scanBlocks(body)
  const texture = lenientScalar(blankSpans(body, blocks), 'texture')
  if (texture === undefined) return null
  const instances = blocks
    .filter((b) => b.key === 'instance')
    .map((b) => parseInstance(body.slice(b.bodyStart, b.bodyEnd)))
  const maskBlock = blocks.find((b) => b.key === 'mask')
  return {
    texture,
    colors: scanColors(blankSpans(body, blocks)),
    mask: maskBlock ? nums(body.slice(maskBlock.bodyStart, maskBlock.bodyEnd)) : [],
    instances: instances.length > 0 ? instances : [{ ...DEFAULT_INSTANCE }]
  }
}

/** Parse one CoA definition body (comment-stripped, @variables substituted). */
export function parseCoaDef(body: string): CoaDef {
  const blocks = scanBlocks(body)
  const emblems: CoaEmblem[] = []
  for (const block of blocks) {
    if (block.key !== 'colored_emblem') continue
    const emblem = parseEmblem(body.slice(block.bodyStart, block.bodyEnd))
    if (emblem) emblems.push(emblem)
  }
  const blanked = blankSpans(body, blocks)
  return {
    pattern: lenientScalar(blanked, 'pattern') ?? null,
    colors: scanColors(blanked),
    emblems
  }
}

/** Substitute `@name = value` script variables into the rest of the file. */
export function substituteVariables(text: string): string {
  const vars = new Map<string, string>()
  for (const m of text.matchAll(/^@([A-Za-z0-9_]+)\s*=\s*(\S+)/gm)) vars.set(m[1], m[2])
  if (vars.size === 0) return text
  return text.replace(/@([A-Za-z0-9_]+)/g, (whole, name) => vars.get(name) ?? whole)
}

// ---------- Rendering ----------

const FALLBACK: Rgb = [128, 128, 128]

function resolveColor(
  raw: RawColor | null,
  named: Map<string, Rgb>,
  coatColors?: Rgb[]
): Rgb | null {
  if (raw === null) return null
  if ('value' in raw) return raw.value
  const backRef = raw.name.match(/^color([1-5])$/)
  if (backRef && coatColors) return coatColors[Number(backRef[1]) - 1] ?? null
  return named.get(raw.name) ?? null
}

/** Bilinear sample, u/v in 0..1, edge-clamped. Writes rgba into `out`. */
function sample(tex: DecodedTexture, u: number, v: number, out: number[]): void {
  const x = Math.min(Math.max(u * tex.width - 0.5, 0), tex.width - 1)
  const y = Math.min(Math.max(v * tex.height - 0.5, 0), tex.height - 1)
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(x0 + 1, tex.width - 1)
  const y1 = Math.min(y0 + 1, tex.height - 1)
  const fx = x - x0
  const fy = y - y0
  const d = tex.rgba
  for (let c = 0; c < 4; c++) {
    const top = d[(y0 * tex.width + x0) * 4 + c] * (1 - fx) + d[(y0 * tex.width + x1) * 4 + c] * fx
    const bot = d[(y1 * tex.width + x0) * 4 + c] * (1 - fx) + d[(y1 * tex.width + x1) * 4 + c] * fx
    out[c] = top * (1 - fy) + bot * fy
  }
}

export type TextureLookup = (
  kind: 'pattern' | 'colored_emblem',
  file: string
) => DecodedTexture | null

/**
 * Software-composite a parsed CoA into a square RGBA buffer.
 * Emblem draw order: by instance depth, larger (further back) first;
 * definition order breaks ties.
 */
export function renderCoa(
  coa: CoaDef,
  named: Map<string, Rgb>,
  getTexture: TextureLookup,
  size = 256
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size * 4)
  const c1 = resolveColor(coa.colors[0], named) ?? FALLBACK
  const c2 = resolveColor(coa.colors[1], named) ?? c1
  const c3 = resolveColor(coa.colors[2], named) ?? c1
  const coatColors: Rgb[] = [
    c1,
    c2,
    c3,
    resolveColor(coa.colors[3], named) ?? c1,
    resolveColor(coa.colors[4], named) ?? c1
  ]

  // Base pattern, keeping the color-zone weights for emblem masks
  const w1 = new Float32Array(size * size)
  const w2 = new Float32Array(size * size)
  const w3 = new Float32Array(size * size)
  const pattern = coa.pattern ? getTexture('pattern', coa.pattern) : null
  const px = [0, 0, 0, 0]
  for (let i = 0; i < size * size; i++) {
    let a1 = 1
    let a2 = 0
    let a3 = 0
    if (pattern) {
      sample(pattern, ((i % size) + 0.5) / size, (Math.floor(i / size) + 0.5) / size, px)
      a3 = px[2] / 255
      a2 = Math.max(0, px[1] - px[2]) / 255
      a1 = Math.max(0, px[0] - px[1]) / 255
    }
    w1[i] = a1
    w2[i] = a2
    w3[i] = a3
    out[i * 4] = c1[0] * a1 + c2[0] * a2 + c3[0] * a3
    out[i * 4 + 1] = c1[1] * a1 + c2[1] * a2 + c3[1] * a3
    out[i * 4 + 2] = c1[2] * a1 + c2[2] * a2 + c3[2] * a3
    out[i * 4 + 3] = 255
  }

  // Flatten to draw ops and order by depth
  const ops = coa.emblems.flatMap((e) => e.instances.map((inst) => ({ e, inst })))
  const order = ops.map((_, i) => i).sort((a, b) => ops[b].inst.depth - ops[a].inst.depth || a - b)

  for (const oi of order) {
    const { e, inst } = ops[oi]
    const tex = getTexture('colored_emblem', e.texture)
    if (!tex || inst.sx === 0 || inst.sy === 0) continue
    const e1 = resolveColor(e.colors[0], named, coatColors) ?? c1
    const e2 = resolveColor(e.colors[1], named, coatColors) ?? e1
    const e3 = resolveColor(e.colors[2], named, coatColors) ?? e1
    const cx = inst.x * size
    const cy = inst.y * size
    const rad = (inst.rotation * Math.PI) / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    // Bounding box of the transformed emblem quad
    const hx = (Math.abs(inst.sx) * size) / 2
    const hy = (Math.abs(inst.sy) * size) / 2
    const ex = Math.abs(cos) * hx + Math.abs(sin) * hy
    const ey = Math.abs(sin) * hx + Math.abs(cos) * hy
    const minX = Math.max(0, Math.floor(cx - ex))
    const maxX = Math.min(size - 1, Math.ceil(cx + ex))
    const minY = Math.max(0, Math.floor(cy - ey))
    const maxY = Math.min(size - 1, Math.ceil(cy + ey))
    for (let ty = minY; ty <= maxY; ty++) {
      for (let tx = minX; tx <= maxX; tx++) {
        const dx = tx + 0.5 - cx
        const dy = ty + 0.5 - cy
        // Inverse of a visually-clockwise rotation (screen y points down)
        const u = (cos * dx + sin * dy) / (inst.sx * size) + 0.5
        const v = (-sin * dx + cos * dy) / (inst.sy * size) + 0.5
        if (u < 0 || u > 1 || v < 0 || v > 1) continue
        sample(tex, u, v, px)
        let alpha = px[3] / 255
        if (alpha <= 0.004) continue
        const i = ty * size + tx
        if (e.mask.length > 0) {
          let f = 0
          for (const zone of e.mask) f += zone === 1 ? w1[i] : zone === 2 ? w2[i] : zone === 3 ? w3[i] : 0
          alpha *= Math.min(1, f)
          if (alpha <= 0.004) continue
        }
        const g = px[1] / 255
        const r = px[0] / 255
        const shade = px[2] / 128
        for (let c = 0; c < 3; c++) {
          const col = (e1[c] * (1 - g) + e2[c] * g) * (1 - r) + e3[c] * r
          out[i * 4 + c] = col * shade * alpha + out[i * 4 + c] * (1 - alpha)
        }
      }
    }
  }
  return out
}

// ---------- File lookup, caching, IPC entry point ----------

const COA_DIR = 'common/coat_of_arms/coat_of_arms'
const GFX_DIRS = { pattern: 'gfx/coat_of_arms/patterns', colored_emblem: 'gfx/coat_of_arms/colored_emblems' }

function norm(id: string): string {
  return id.trim().toLowerCase()
}

let cacheKey = ''
let defsCache: Map<string, string> | null = null
let namedCache: Map<string, Rgb> | null = null
const textureCache = new Map<string, DecodedTexture | null>()
const urlCache = new Map<string, string | null>()

/** id -> definition body, mod files layered over the game's. */
function loadDefs(gameDir: string | null, modPath: string | null, replacePaths: string[]): Map<string, string> {
  const defs = new Map<string, string>()
  for (const file of effectiveFiles(gameDir, modPath, replacePaths, COA_DIR)) {
    try {
      const text = substituteVariables(stripComments(readFileSync(file, 'utf-8')))
      for (const block of scanBlocks(text)) {
        defs.set(norm(block.key), text.slice(block.bodyStart, block.bodyEnd))
      }
    } catch {
      // skip unreadable files
    }
  }
  return defs
}

function loadNamedColors(
  gameDir: string | null,
  modPath: string | null,
  replacePaths: string[]
): Map<string, Rgb> {
  const named = new Map<string, Rgb>()
  for (const file of effectiveFiles(gameDir, modPath, replacePaths, 'common/named_colors')) {
    try {
      for (const [name, rgb] of parseNamedColors(readFileSync(file, 'utf-8'))) named.set(name, rgb)
    } catch {
      // skip unreadable files
    }
  }
  return named
}

function makeTextureLookup(
  gameDir: string | null,
  modPath: string | null,
  replacePaths: string[]
): TextureLookup {
  return (kind, file) => {
    const relDir = GFX_DIRS[kind]
    const name = basename(file.replace(/\\/g, '/'))
    const replaced = replacePaths.some((rp) => {
      const nrp = rp.replace(/\\/g, '/').toLowerCase()
      return relDir === nrp || relDir.startsWith(nrp + '/')
    })
    const candidates: string[] = []
    if (modPath) candidates.push(join(modPath, ...relDir.split('/'), name))
    if (gameDir && !replaced) candidates.push(join(gameDir, ...relDir.split('/'), name))
    for (const path of candidates) {
      if (textureCache.has(path)) {
        const hit = textureCache.get(path)!
        if (hit) return hit
        continue
      }
      let decoded: DecodedTexture | null = null
      if (existsSync(path)) {
        try {
          decoded = decodeDds(readFileSync(path))
        } catch {
          decoded = null
        }
      }
      textureCache.set(path, decoded)
      if (decoded) return decoded
    }
    return null
  }
}

const RENDER_SIZE = 256

/**
 * Render the coats of arms with the given ids (dynasty, house, or title ids —
 * CoA definitions are keyed by them) to PNG data URLs. Ids without a
 * definition map to null.
 */
export function getCoatsOfArms(
  gameDir: string | null,
  modPath: string | null,
  replacePaths: string[],
  ids: string[]
): Record<string, string | null> {
  const key = `${gameDir}|${modPath}`
  if (key !== cacheKey) {
    cacheKey = key
    defsCache = null
    namedCache = null
    textureCache.clear()
    urlCache.clear()
  }
  defsCache ??= loadDefs(gameDir, modPath, replacePaths)
  namedCache ??= loadNamedColors(gameDir, modPath, replacePaths)
  const getTexture = makeTextureLookup(gameDir, modPath, replacePaths)

  const result: Record<string, string | null> = {}
  for (const id of ids) {
    const cached = urlCache.get(norm(id))
    if (cached !== undefined) {
      result[id] = cached
      continue
    }
    let url: string | null = null
    const body = defsCache.get(norm(id))
    if (body !== undefined) {
      try {
        const rgba = renderCoa(parseCoaDef(body), namedCache, getTexture, RENDER_SIZE)
        const png = encodePng(RENDER_SIZE, RENDER_SIZE, Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength))
        url = `data:image/png;base64,${png.toString('base64')}`
      } catch {
        url = null
      }
    }
    urlCache.set(norm(id), url)
    result[id] = url
  }
  return result
}
