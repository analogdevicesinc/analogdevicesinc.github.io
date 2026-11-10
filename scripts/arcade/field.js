"use strict";

// Shared pixel-field renderer and math helpers for the arcade games. The field
// is the same top-down square grid as the landing page hero: every cell asks a
// sampler for a level (cool, grows the square), a heat (warm, noise) and,
// optionally, a light (white, for something that must stand out) or a color
// (tints the cool square, e.g. to tell pairs of things apart).

export const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value))
export const mix = (a, b, amount) => a + (b - a) * amount

const fade = value => value * value * (3 - 2 * value)

export const hash = (x, y) => {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123
  return value - Math.floor(value)
}

export const noise = (x, y) => {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const tx = fade(x - x0)
  const ty = fade(y - y0)
  const top = mix(hash(x0, y0), hash(x0 + 1, y0), tx)
  const bottom = mix(hash(x0, y0 + 1), hash(x0 + 1, y0 + 1), tx)
  return mix(top, bottom, ty)
}

// Difficulty over time survived, 0..1 as a smoothstep: it eases in, so the
// opening is a warm-up, ramps through the middle, then eases out and holds
// at 1 from `horizon` seconds on. The plateau is hard but fair, so long runs
// end on the player's focus, not on a curve that becomes impossible.
export const difficulty = (time, horizon) => {
  const x = clamp(time / horizon)
  return x * x * (3 - 2 * x)
}

// Crossing waves plus noise, in normalized coordinates, returning 0..1.
export const ambient = (u, v, time) => {
  let level = 0.5
  level += Math.sin(u * 8.5 + v * 5.2 - time * 1.25) * 0.23
  level += Math.sin(u * -3.8 + v * 10.5 + time * 0.82) * 0.13
  level += Math.sin((u + v) * 18 - time * 1.8) * 0.05
  level += (noise(u * 5.2 + time * 0.11, v * 5.2 - time * 0.08) - 0.5) * 0.36
  return clamp(level)
}

const cool = ["#627eea", "#6e8ef2", "#64a9ee", "#62c5dd", "#8bd7cf", "#c1b4ef"]
const warm = ["#f2994a", "#f47b5a", "#ef5d6b", "#ff8f70", "#ffc36b"]

export class Field {
  constructor () {
    // Reused for every cell to avoid allocating per sample.
    this.sample = { level: 0, heat: 0, light: 0, color: null }
  }

  // sampler(center_x, center_y, column, row, out) writes out.level,
  // out.heat, out.light and out.color; a negative level skips the cell.
  // White wins over warm, warm over color, color over the cool palette.
  //
  // By default the grid is centered on the screen. Pass `cell`/`gap` to size
  // it, and `anchor_x`/`anchor_y` to put a cell corner on a given point, so a
  // game board lines up with the field squares.
  draw (ctx, width, height, sampler, options = {}) {
    const cell = options.cell ?? (width < 640 ? 15 : 19)
    const gap = options.gap ?? (width < 640 ? 3 : 4)
    let columns, rows, offset_x, offset_y

    if (options.anchor_x !== undefined) {
      offset_x = options.anchor_x - Math.ceil(options.anchor_x / cell) * cell
      offset_y = options.anchor_y - Math.ceil(options.anchor_y / cell) * cell
      columns = Math.ceil((width - offset_x) / cell)
      rows = Math.ceil((height - offset_y) / cell)
    } else {
      columns = Math.ceil(width / cell) + 1
      rows = Math.ceil(height / cell) + 1
      offset_x = Math.round((width - columns * cell) * 0.5)
      offset_y = Math.round((height - rows * cell) * 0.5)
    }
    const max_size = cell - gap
    const min_size = Math.max(1, cell * 0.14)
    const out = this.sample

    for (let row = 0; row < rows; row++) {
      const center_y = offset_y + (row + 0.5) * cell

      for (let column = 0; column < columns; column++) {
        const center_x = offset_x + (column + 0.5) * cell

        out.level = 0
        out.heat = 0
        out.light = 0
        out.color = null
        sampler(center_x, center_y, column, row, out)
        if (out.level < 0) continue

        const heat = clamp(out.heat)
        const light = clamp(out.light)
        const level = clamp(Math.max(out.level, heat, light))
        const crest = Math.pow(level, 1.5)
        const size = mix(min_size, max_size, crest)
        const half = size * 0.5

        if (light > 0.12 && light >= heat) {
          ctx.globalAlpha = mix(0.3, 1, light)
          ctx.fillStyle = '#ffffff'
        } else if (heat > 0.12) {
          ctx.globalAlpha = mix(0.25, 0.95, heat)
          ctx.fillStyle = warm[Math.min(warm.length - 1, Math.floor(heat * warm.length))]
        } else if (out.color) {
          ctx.globalAlpha = mix(0.3, 1, crest)
          ctx.fillStyle = out.color
        } else {
          ctx.globalAlpha = mix(0.06, 0.6, crest)
          ctx.fillStyle = cool[Math.min(cool.length - 1, Math.floor(level * cool.length))]
        }
        ctx.fillRect(center_x - half, center_y - half, size, size)
      }
    }

    ctx.globalAlpha = 1
  }
}
