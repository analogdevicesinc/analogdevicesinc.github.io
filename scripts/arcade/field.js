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

// Depth ratio between rows of a perspective plane (see Field.draw_plane):
// a row's height on screen matches a column's width there.
export const plane_step = ({ horizon, near_y, unit, cell, z_near = 1 }) =>
  cell * unit / ((near_y - horizon) * z_near)

// Shades one sample: sets the fill for out and returns its crest (0..1),
// which sizes the square. White wins over warm, warm over color, color over
// the cool palette; out.alpha (1 by default) fades the whole square.
const shade = (ctx, out) => {
  const heat = clamp(out.heat)
  const light = clamp(out.light)
  const level = clamp(Math.max(out.level, heat, light))
  const crest = Math.pow(level, 1.5)

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
  ctx.globalAlpha *= clamp(out.alpha)
  return crest
}

export class Field {
  constructor () {
    // Reused for every cell to avoid allocating per sample.
    this.sample = { level: 0, heat: 0, light: 0, color: null, alpha: 1 }
  }

  reset_sample () {
    const out = this.sample
    out.level = 0
    out.heat = 0
    out.light = 0
    out.color = null
    out.alpha = 1
    return out
  }

  // sampler(center_x, center_y, column, row, out) writes out.level,
  // out.heat, out.light, out.color and out.alpha; a negative level skips the
  // cell.
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

    for (let row = 0; row < rows; row++) {
      const center_y = offset_y + (row + 0.5) * cell

      for (let column = 0; column < columns; column++) {
        const center_x = offset_x + (column + 0.5) * cell

        const out = this.reset_sample()
        sampler(center_x, center_y, column, row, out)
        if (out.level < 0) continue

        const size = mix(min_size, max_size, shade(ctx, out))
        ctx.fillRect(center_x - size * 0.5, center_y - size * 0.5, size, size)
      }
    }

    ctx.globalAlpha = 1
  }

  // The same field laid on a ground plane seen in perspective, receding to a
  // horizon. The sampler works in plane coordinates instead of pixels:
  // sampler(u, z, column, row, out), u across (0 straight ahead) and z the
  // depth, both in plane units. Columns are `cell` units apart, centered on
  // u = u_start + column * cell. Rows step in depth by a constant ratio
  // (plane_step), from z_near to z_far, so every cell looks square on screen.
  //
  // Projection: depth z_near lands on `near_y`, `horizon` is infinitely far,
  // and one unit across at depth 1 is `unit` pixels.
  //
  // `shift(z)`, if given, slides each row across by that many units, so the
  // columns can follow a curving road; u then includes the shift.
  draw_plane (ctx, width, height, sampler, {
    horizon,
    near_y,
    unit,
    cell,
    u_start,
    columns,
    z_near = 1,
    z_far = 14,
    gap = 0.2,
    shift = null,
  }) {
    const center = width / 2
    const step = plane_step({ horizon, near_y, unit, cell, z_near })
    const rows = Math.floor(Math.log(z_far / z_near) / Math.log(1 + step)) + 1

    // Far to near, so nearer squares are painted over farther ones.
    for (let row = rows - 1; row >= 0; row--) {
      const z = z_near * Math.pow(1 + step, row)
      const y = horizon + (near_y - horizon) * z_near / z
      if (y > height + cell * unit) continue
      const size_px = cell * unit / z
      const max_size = size_px * (1 - gap)
      const min_size = Math.max(1, size_px * 0.14)
      const offset = shift ? shift(z) : 0

      for (let column = 0; column < columns; column++) {
        const u = offset + u_start + column * cell
        const x = center + u * unit / z
        if (x < -size_px || x > width + size_px) continue

        const out = this.reset_sample()
        sampler(u, z, column, row, out)
        if (out.level < 0) continue

        const size = mix(min_size, max_size, shade(ctx, out))
        ctx.fillRect(x - size * 0.5, y - size * 0.5, size, size)
      }
    }

    ctx.globalAlpha = 1
  }
}
