"use strict";

import { clamp, hash, ambient } from '../field.js'
import { text, wrap, hud, hud_bottom } from '../ui.js'

// Frequency Hopper: a carrier crosses a crowded spectrum. Time runs left to
// right, frequency bottom to top. Each tap hops the carrier up the band, and
// it drifts down between hops. Congested bands (Wi-Fi, Bluetooth, LTE...)
// block the spectrum, leaving one clear channel to slip through.
//
// - One hit ends the run: touching a band or leaving the spectrum.
// - Passing through the middle of the channel is a clean pass; consecutive
//   clean passes build a streak multiplier. Data packets waiting in the
//   channel are a bonus.
// - The carrier, its trace and the bands are drawn only by the pixel field.
// - Difficulty is a function of time survived: bands come faster with
//   narrower channels, and later some channels hop up and down.

const TAU = Math.PI * 2
const rand = (min, max) => min + Math.random() * (max - min)

const tier_seconds = 15
const max_streak = 5
// Bumped when the rules change, so old scores don't outlive a rebalance.
const best_key = 'best.v2'

// Vertical motion in spectrum heights (per second, per second squared), so
// the feel is the same on any screen.
const gravity = 2.3
const hop_velocity = -0.62
const max_fall = 0.95
const bottom_margin = 24

const colors = {
  text: '#e9eef5',
  muted: 'rgba(233, 238, 245, .62)',
  accent: '#62c5dd',
  gold: '#ffc36b',
  danger: '#ff6b6b',
  noise: '255, 122, 89',
  cool: '139, 215, 207',
}

class FrequencyHopper {
  constructor (stage) {
    this.stage = stage
    this.store = stage.storage('frequency-hopper')
    this.best = Number(this.store.get(best_key, 0)) || 0
    this.time = 0
    this.state = 'ready'
    this.state_time = 0
    this.trail_at = new Float32Array(0)
    this.reset()
  }

  get tier () { return 1 + Math.floor(this.elapsed / tier_seconds) }

  // Spectrum geometry, below the HUD.
  get top () { return hud_bottom }
  get bottom () { return Math.max(this.top + 120, this.stage.height - bottom_margin) }
  get span () { return this.bottom - this.top }
  get sx () { return clamp(this.stage.width * 0.26, 60, 420) }
  get sy () { return this.top + this.y * this.span }
  get radius () { return clamp(this.span * 0.018, 7, 13) }

  // Scroll speed follows the spectrum height, so hop arcs keep their shape.
  get speed () {
    const ramp = 1 + clamp(this.elapsed / 150) * 0.6
    return this.span * 0.31 * ramp
  }

  reset () {
    this.score = 0
    this.elapsed = 0
    this.level = 1
    this.y = 0.5
    this.vy = 0
    this.columns = []
    this.trail = []
    this.pulses = []
    this.spawn_timer = 0.9
    this.last_center = 0.5
    this.streak = 0
    this.shake = 0
    this.flash = 0
    this.best_beaten = false
  }

  start () {
    this.reset()
    this.state = 'playing'
    this.state_time = 0
  }

  // -- Input ----------------------------------------------------------------

  pointer (type) {
    if (type === 'down') this.press()
  }

  key (type, event) {
    if (event.key !== ' ' && event.key !== 'ArrowUp' && event.key !== 'Enter') return false
    if (type === 'down' && !event.repeat) this.press()
    return true
  }

  press () {
    if (this.state === 'playing') {
      this.hop()
      return
    }
    // Ignore presses right after losing, so a frantic last hop doesn't skip
    // the score screen.
    if (this.state === 'over' && this.state_time < 0.9) return
    this.start()
    this.hop()
  }

  hop () {
    this.vy = hop_velocity
    this.pulses.push({ x: this.sx, y: this.sy, age: 0, life: 0.35, cool: true })
  }

  // -- Spawning -------------------------------------------------------------

  spawn_column () {
    const t = this.elapsed
    const span = this.span
    // Never narrower than a few carrier diameters, even on short screens.
    const gap = Math.max(0.2 - clamp((t - 60) / 120) * 0.03, 0.34 - t * 0.0013, (this.radius * 6) / span)
    const low = 0.06 + gap / 2
    const high = 0.94 - gap / 2
    // Keep the next channel within reach of the last one.
    const reach = 0.42
    const center = clamp(rand(Math.max(low, this.last_center - reach), Math.min(high, this.last_center + reach)), low, high)
    this.last_center = center

    const hopping = t > 20 && Math.random() < clamp((t - 20) / 80, 0, 0.5)
    const amplitude = hopping ? Math.min(rand(0.06, 0.14), center - low, high - center) : 0

    const column = {
      x: this.stage.width + 8,
      width: clamp(span * 0.075, 34, 64),
      base: center,
      center,
      gap,
      amplitude,
      phase: rand(0, TAU),
      freq: rand(1.2, 2.2),
      hit: false,
      passed: false,
      flash: 0,
      packet: null,
    }
    if (t > 3 && Math.random() < 0.35) {
      column.packet = { offset: rand(-0.25, 0.25) * gap, taken: false, seed: rand(0, 1000) }
    }
    this.columns.push(column)
  }

  // -- Outcomes -------------------------------------------------------------

  // One hit and the run is over.
  jam () {
    if (this.state !== 'playing') return false
    this.flash = 1
    this.shake = this.stage.reduced_motion() ? 0 : 0.6
    this.pulses.push({ x: this.sx, y: this.sy, age: 0, life: 1.2, cool: false })
    this.burst(this.sx, this.sy, colors.noise)
    this.game_over()
    return true
  }

  pass (column) {
    column.passed = true
    if (column.hit || this.state !== 'playing') return

    const gap_center = this.top + column.center * this.span
    const clean = Math.abs(this.sy - gap_center) < column.gap * this.span * 0.2
    this.streak = clean ? Math.min(max_streak, this.streak + 1) : 0
    const points = 10 * this.tier * (clean ? 2 * this.streak : 1)
    this.score += points
  }

  collect (column, x, y) {
    column.packet.taken = true
    const points = 25 * this.tier
    this.score += points
    this.pulses.push({ x, y, age: 0, life: 0.6, cool: true })
    this.burst(x, y, colors.cool)
  }

  game_over () {
    this.state = 'over'
    this.state_time = 0
    if (this.score > this.best) {
      this.best = this.score
      this.best_beaten = true
      this.store.set(best_key, this.best)
    }
  }

  // A small ring popping out of the field.
  burst (x, y, color) {
    this.pulses.push({ x, y, age: 0, life: 0.45, speed: 300, cool: color === colors.cool })
  }

  // -- Simulation -----------------------------------------------------------

  update (dt) {
    this.time += dt
    this.state_time += dt
    this.shake = Math.max(0, this.shake - dt * 2.4)
    this.flash = Math.max(0, this.flash - dt * 3)

    const playing = this.state === 'playing'
    const span = this.span
    const radius = this.radius
    const scroll = this.state === 'over' ? 0 : this.speed * (playing ? 1 : 0.6)

    if (playing) {
      this.elapsed += dt
      const t = this.elapsed

      this.level = this.tier

      this.spawn_timer -= dt
      if (this.spawn_timer <= 0) {
        this.spawn_column()
        this.spawn_timer = Math.max(0.95, 1.5 - t * 0.006) * rand(0.9, 1.1)
      }
    }

    // The carrier: bobbing on the title screen, ballistic otherwise. After a
    // loss it drops out of the spectrum.
    if (this.state === 'ready') {
      this.y = 0.5 + Math.sin(this.time * 2.2) * 0.04
    } else {
      this.vy = Math.min(max_fall, this.vy + gravity * dt)
      this.y += this.vy * dt
      if (this.state === 'over') {
        this.y = Math.min(this.y, 1)
      } else if (this.y < 0) {
        this.y = 0
        this.vy = 0
        this.jam()
      } else if (this.y > 1) {
        this.y = 1
        this.jam()
      }
    }

    const sx = this.sx
    const sy = this.sy

    for (const column of this.columns) {
      column.x -= scroll * dt
      column.flash = Math.max(0, column.flash - dt * 3)
      if (column.amplitude && this.state !== 'over') {
        column.center = column.base + Math.sin(this.time * column.freq + column.phase) * column.amplitude
      }
      if (!playing) continue

      const overlaps = sx + radius > column.x && sx - radius < column.x + column.width
      if (overlaps) {
        const gap_top = this.top + (column.center - column.gap / 2) * span
        const gap_bottom = this.top + (column.center + column.gap / 2) * span
        if (sy - radius < gap_top || sy + radius > gap_bottom) {
          if (this.jam()) {
            column.hit = true
            column.flash = 1
          }
        }
      }

      const packet = column.packet
      if (packet && !packet.taken) {
        const px = column.x + column.width / 2
        const py = this.top + column.center * span + packet.offset * span
        if (Math.hypot(px - sx, py - sy) < radius + radius * 1.2) this.collect(column, px, py)
      }

      if (!column.passed && column.x + column.width < sx - radius) this.pass(column)
    }
    this.columns = this.columns.filter(column => column.x + column.width > -40)

    // The trace the carrier leaves behind, scrolling off with the spectrum.
    if (this.state !== 'over') {
      for (const point of this.trail) point.x -= scroll * dt
      this.trail.push({ x: sx, y: sy })
      this.trail = this.trail.filter(point => point.x > -20)
    }

    for (const pulse of this.pulses) pulse.age += dt
    this.pulses = this.pulses.filter(entry => entry.age < entry.life)
  }

  // -- Rendering ------------------------------------------------------------

  render (ctx) {
    const { width, height } = this.stage

    ctx.save()
    if (this.shake > 0) {
      ctx.translate((Math.random() - 0.5) * 12 * this.shake, (Math.random() - 0.5) * 12 * this.shake)
    }
    this.draw_field(ctx, width, height)
    this.draw_frame(ctx, width)
    ctx.restore()

    this.draw_hud(ctx)
    if (this.state !== 'playing') this.draw_screen(ctx, width, height)
  }

  // Trail height per 6px column of the screen, for the field sampler.
  build_trail (width) {
    const size = Math.ceil(width / 6) + 2
    if (this.trail_at.length !== size) this.trail_at = new Float32Array(size)
    this.trail_at.fill(NaN)
    for (const point of this.trail) {
      const k = Math.floor(point.x / 6)
      if (k >= 0 && k < size) this.trail_at[k] = point.y
    }
  }

  draw_field (ctx, width, height) {
    const { top, bottom, span, columns, pulses, trail_at } = this
    const time = this.time
    const flicker = Math.floor(time * 16)
    const sx = this.sx
    const sy = this.sy
    // Tight spot, so the visible carrier is about its hit radius.
    const glow = this.radius * 0.9
    const trace = this.radius * 1.1
    const lost = this.state === 'over'
    // Bands are drawn by the field alone, so only light cells whose center
    // sits (almost) inside the band: what you see is what hits.
    const pad = 3

    this.build_trail(width)

    // Data packets: small pulsing cyan diamonds of cells.
    const diamond = this.radius * 2.4
    const packets = []
    for (const col of columns) {
      const packet = col.packet
      if (!packet || packet.taken) continue
      packets.push(col.x + col.width / 2, top + (col.center + packet.offset) * span,
        0.85 + 0.25 * Math.sin(time * 6 + packet.seed))
    }

    this.stage.field.draw(ctx, width, height, (x, y, column, row, out) => {
      const in_band = y > top && y < bottom
      let level = ambient(x / width, y / height, time) * (in_band ? 0.36 : 0.16)
      let heat = 0

      if (in_band) {
        // Congested bands: occupied cells run hot, hottest at the channel edge.
        for (let k = 0; k < columns.length; k++) {
          const col = columns[k]
          if (x < col.x - pad || x > col.x + col.width + pad) continue
          const gap_top = top + (col.center - col.gap / 2) * span
          const gap_bottom = top + (col.center + col.gap / 2) * span
          const edge = y < gap_top ? gap_top - y : y > gap_bottom ? y - gap_bottom : -1
          if (edge < 0) continue
          heat += 0.42 + Math.exp(-edge / 40) * 0.45 + col.flash * 0.4
        }
        if (heat > 0.02) heat *= 0.65 + 0.5 * hash(column + flicker * 0.37, row)

        const ty = trail_at[Math.floor(x / 6)]
        if (ty === ty && x < sx) {
          const dy = y - ty
          level += Math.exp(-(dy * dy) / (2 * trace * trace)) * 0.55 * (0.25 + 0.75 * x / sx)
        }
      }

      const dx = x - sx
      const dy = y - sy
      // The carrier itself: a white spot, hot once the run is over.
      const spot = Math.exp(-(dx * dx + dy * dy) / (2 * glow * glow)) * 1.1
      let light = 0
      if (lost) heat += spot
      else light = spot

      for (let k = 0; k < packets.length; k += 3) {
        const l1 = Math.abs(x - packets[k]) + Math.abs(y - packets[k + 1])
        if (l1 < diamond) level += Math.sqrt(1 - l1 / diamond) * packets[k + 2]
      }

      for (let k = 0; k < pulses.length; k++) {
        const pulse = pulses[k]
        const front = Math.hypot(x - pulse.x, y - pulse.y) - pulse.age * (pulse.speed ?? 420)
        const strength = Math.exp(-Math.abs(front) / 30) * (1 - pulse.age / pulse.life) * 0.8
        if (pulse.cool) level += strength
        else heat += strength
      }

      // Cap below the top of the cool palette (lavender): data, trace and hop
      // pulses stay cyan, and only the carrier is white.
      out.level = Math.min(level, 0.82)
      out.heat = heat
      out.light = light
    })
  }

  // The edges of the spectrum: leaving it ends the run.
  draw_frame (ctx, width) {
    const { top, bottom } = this

    ctx.lineWidth = 1
    ctx.setLineDash([2, 6])
    ctx.strokeStyle = 'rgba(139, 215, 207, .35)'
    ctx.beginPath()
    ctx.moveTo(0, top)
    ctx.lineTo(width, top)
    ctx.moveTo(0, bottom)
    ctx.lineTo(width, bottom)
    ctx.stroke()
    ctx.setLineDash([])
  }

  draw_hud (ctx) {
    hud(ctx, this.stage.font, this.stage.width, {
      score: this.score,
      level: this.level,
      elapsed: this.elapsed,
      best: this.best,
      playing: this.state === 'playing',
    })
  }

  draw_screen (ctx, width, height) {
    ctx.fillStyle = 'rgba(7, 11, 18, .72)'
    ctx.fillRect(0, 0, width, height)

    const center = width / 2
    const max_width = Math.min(width - 48, 640)
    const title = clamp(width * 0.06, 26, 56)
    const lines = []
    const add = (value, style, lead) => lines.push({ value, style, lead })
    const paragraph = (value, style, lead) => {
      this.wrap(ctx, value, max_width, style).forEach((line, i) => add(line, style, i ? style.size * 1.4 : lead))
    }

    if (this.state === 'ready') {
      add('ADI ARCADE  ·  ELECTRONICA 2026', { size: 12, weight: 700, color: colors.accent, spacing: '3px' }, 0)
      add('FREQUENCY HOPPER', { size: title, weight: 800, spacing: '2px' }, title + 12)
      paragraph('Hop your carrier through the clear channel between congested bands. Tap to hop up, it drifts down on its own.',
        { size: 16, weight: 500, color: colors.muted }, 34)
      paragraph('Touch a band or leave the spectrum and it is over. Grab the data, chain clean passes. It gets faster every second.',
        { size: 14, weight: 500, color: colors.muted }, 26)
    } else {
      add(`GAME OVER  ·  SURVIVED ${Math.floor(this.elapsed)}s`, { size: 12, weight: 700, color: colors.danger, spacing: '3px' }, 0)
      add(String(this.score), { size: title * 1.15, weight: 800 }, title * 1.15 + 12)
      add(this.best_beaten ? 'New best score!' : `Best ${this.best}`,
        { size: 16, weight: 700, color: this.best_beaten ? colors.gold : colors.muted }, 34)
    }

    const total = lines.reduce((sum, line) => sum + line.lead, 0)
    let y = Math.max(70, (height - total) / 2 - 30)
    for (const line of lines) {
      y += line.lead
      this.text(ctx, line.value, center, y, { ...line.style, align: 'center' })
    }

    if (this.state === 'over' && this.state_time < 0.9) return

    ctx.globalAlpha = 0.55 + 0.45 * Math.sin(this.time * 4)
    this.text(ctx, this.state === 'ready' ? 'Tap to start' : 'Tap to play again', center, y + 48, {
      size: 15, weight: 700, color: colors.text, align: 'center', spacing: '1px',
    })
    ctx.globalAlpha = 1
  }

  wrap (ctx, value, max_width, style) {
    return wrap(ctx, this.stage.font, value, max_width, style)
  }

  text (ctx, value, x, y, style) {
    text(ctx, this.stage.font, value, x, y, style)
  }

  destroy () {}
}

export default {
  id: 'frequency-hopper',
  name: 'Frequency Hopper',
  tagline: 'Hop through the gaps of a crowded spectrum.',
  controls: 'Tap to hop',
  color: '#ffa3ab',
  available: true,
  icon: '<svg class="no-background" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="16" y="4" width="8" height="14" opacity=".6"/><rect x="16" y="30" width="8" height="14" opacity=".6"/><rect x="32" y="4" width="8" height="22" opacity=".6"/><rect x="32" y="36" width="8" height="8" opacity=".6"/><path d="M4 30c4 0 6-6 10-6s6 0 10 0 6 8 10 8 6 0 10 0"/></svg>',
  create: stage => new FrequencyHopper(stage),
}
