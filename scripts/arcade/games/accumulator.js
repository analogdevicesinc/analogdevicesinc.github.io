"use strict";

import { clamp, mix, hash, ambient, difficulty } from '../field.js'
import { text, wrap, hud } from '../ui.js'

// Accumulator: absorb the data bits and every signal smaller than you, avoid
// the bigger ones, in a world larger than the screen. Everything is drawn by
// the pixel field: you are white, what you can absorb is cool, what can absorb
// you runs hot, the rest is grey.
//
// - A mouse steers by being followed; a touch anywhere opens a joystick
//   right there, and dragging from it steers.
// - Right click, Space or the on-screen button splits every cell big enough
//   toward the pointer; holding it instead pulls the cells together to merge.
// - A cell absorbs another a quarter lighter than itself once it covers it.
// - Difficulty follows time survived on an ease-in-out curve: the other
//   signals spawn bigger, relative to you, and chase harder, then level off.

const rand = (min, max) => min + Math.random() * (max - min)

const world_size = 3600
const food_count = 360
const start_mass = 20
const min_split_mass = 36
const max_cells = 16
const eat_ratio = 1.25
const hold_time = 0.28
const ramp_seconds = 180
const tier_seconds = 15
const best_key = 'best'

const colors = {
  text: '#e9eef5',
  muted: 'rgba(233, 238, 245, .62)',
  accent: '#62c5dd',
  danger: '#ff6b6b',
  gold: '#ffc36b',
  edible: '#62c5dd',
  food: '#8bd7cf',
  neutral: '#8fa3b8',
}

const radius_of = mass => Math.sqrt(mass) * 10
const speed_of = mass => 300 * Math.pow(mass / start_mass, -0.3)

class Accumulator {
  constructor (stage) {
    this.stage = stage
    this.store = stage.storage('accumulator')
    this.best = Number(this.store.get(best_key, 0)) || 0
    this.time = 0
    this.state = 'ready'
    this.state_time = 0
    this.steer = null
    this.stick = null
    this.food_at = new Float32Array(0)
    this.reset()
  }

  get tier () { return 1 + Math.floor(this.elapsed / tier_seconds) }
  get ramp () { return difficulty(this.elapsed, ramp_seconds) }
  get mass () { return this.cells.reduce((sum, cell) => sum + cell.m, 0) }

  // Field cell size; the grid is anchored at the top left corner.
  get cell () { return this.stage.width < 640 ? 15 : 19 }

  // Radius of the touch joystick.
  get stick_radius () {
    return clamp(Math.min(this.stage.width, this.stage.height) * 0.11, 48, 72)
  }

  // On-screen split/merge button, bottom right.
  get button () {
    const { width, height } = this.stage
    const r = clamp(Math.min(width, height) * 0.07, 30, 46)
    return { x: width - r - 24, y: height - r - 24, r }
  }

  reset () {
    const center = world_size / 2
    this.score = start_mass
    this.peak = start_mass
    this.elapsed = 0
    this.level = 1
    this.cells = [{ x: center, y: center, m: start_mass, vx: 0, vy: 0, bx: 0, by: 0, seed: rand(0, 1000) }]
    this.bots = []
    this.pulses = []
    this.food = Array.from({ length: food_count }, () => ({ x: rand(0, world_size), y: rand(0, world_size), seed: rand(0, 1000) }))
    this.action = null
    this.merging = false
    this.flash = 0
    this.best_beaten = false
    this.cam = { x: center, y: center }
    this.scale = this.target_scale()
    for (let i = 0; i < 10; i++) this.spawn_bot()
  }

  start () {
    this.reset()
    this.stick = null
    this.state = 'playing'
    this.state_time = 0
  }

  // -- View -----------------------------------------------------------------

  // The camera zooms out as you grow, slower than you grow, so you get
  // bigger on screen while seeing more of the world.
  target_scale () {
    const { width, height } = this.stage
    const radius = radius_of(Math.max(start_mass, this.mass))
    const on_screen = Math.min(width, height) * 0.065 * Math.pow(radius / radius_of(start_mass), 0.4)
    return clamp(on_screen / radius, 0.1, 2)
  }

  to_world (x, y) {
    return [(x - this.stage.width / 2) / this.scale + this.cam.x, (y - this.stage.height / 2) / this.scale + this.cam.y]
  }

  to_screen (x, y) {
    return [(x - this.cam.x) * this.scale + this.stage.width / 2, (y - this.cam.y) * this.scale + this.stage.height / 2]
  }

  centroid () {
    let x = 0
    let y = 0
    let m = 0
    for (const cell of this.cells) {
      x += cell.x * cell.m
      y += cell.y * cell.m
      m += cell.m
    }
    return m ? [x / m, y / m] : [this.cam.x, this.cam.y]
  }

  target () {
    if (this.stick) {
      const [x, y] = this.centroid()
      return [x + this.stick.dx * 1000, y + this.stick.dy * 1000]
    }
    return this.steer ? this.to_world(this.steer[0], this.steer[1]) : this.centroid()
  }

  // Deflection from where the touch landed, as a direction scaled 0..1.
  aim (x, y) {
    const r = this.stick_radius
    const dx = (x - this.stick.x) / r
    const dy = (y - this.stick.y) / r
    const length = Math.hypot(dx, dy)
    const scale = length > 1 ? 1 / length : 1
    this.stick.dx = dx * scale
    this.stick.dy = dy * scale
  }

  // -- Input ----------------------------------------------------------------

  // A mouse is followed: the blob heads for it. A touch opens a joystick
  // where it lands; dragging steers, lifting stops. Right click and the
  // button split and merge, for either.
  pointer (type, x, y, event) {
    const mouse = event.pointerType === 'mouse'
    if (type === 'move') {
      if (this.stick?.id === event.pointerId) this.aim(x, y)
      else if (mouse) this.steer = [x, y]
      return
    }

    const source = mouse ? `mouse${event.button}` : event.pointerId
    if (type === 'down') {
      if (this.state !== 'playing') {
        // Ignore presses right after losing, so a frantic last split doesn't
        // skip the score screen.
        if (this.state === 'over' && this.state_time < 0.9) return
        this.start()
      }
      const button = this.button
      if (event.button === 2 || Math.hypot(x - button.x, y - button.y) < button.r * 1.2) {
        if (this.state === 'playing' && this.state_time > 0) this.press(source)
        return
      }
      if (mouse) this.steer = [x, y]
      else if (!this.stick) {
        // Centered on a field cell, so its base is drawn as a round disc.
        const cell = this.cell
        const cx = (Math.floor(x / cell) + 0.5) * cell
        const cy = (Math.floor(y / cell) + 0.5) * cell
        this.stick = { id: event.pointerId, x: cx, y: cy, dx: 0, dy: 0 }
        this.aim(x, y)
      }
      return
    }

    // 'up' and 'cancel'.
    if (this.stick?.id === event.pointerId) {
      this.stick = null
      return
    }
    this.release(source)
  }

  key (type, event) {
    if (event.key !== ' ') return false
    if (type === 'down' && !event.repeat) {
      if (this.state === 'playing') this.press('key')
      else if (this.state === 'ready' || this.state_time >= 0.9) this.start()
    } else if (type === 'up') {
      this.release('key')
    }
    return true
  }

  // A press splits on release, unless it was held long enough to merge.
  press (source) {
    if (this.action) return
    this.action = { source, time: this.time }
  }

  release (source) {
    if (!this.action || this.action.source !== source) return
    if (!this.merging && this.state === 'playing') this.split()
    this.merging = false
    this.action = null
  }

  // -- Spawning -------------------------------------------------------------

  // Half the signals are small fry; the rest scale with you, and grow
  // relatively bigger along the difficulty curve.
  spawn_bot () {
    const m = Math.random() < 0.5
      ? rand(8, 40)
      : Math.max(8, this.mass * rand(0.35, mix(1.4, 2.4, this.ramp)))
    const r = radius_of(m)
    const { width, height } = this.stage
    const half_w = width / 2 / this.scale + r
    const half_h = height / 2 / this.scale + r
    let x, y
    for (let attempt = 0; attempt < 20; attempt++) {
      x = rand(r, world_size - r)
      y = rand(r, world_size - r)
      // Spawn out of sight.
      if (Math.abs(x - this.cam.x) > half_w || Math.abs(y - this.cam.y) > half_h) break
    }
    const angle = rand(0, Math.PI * 2)
    this.bots.push({ x, y, m, vx: 0, vy: 0, hx: Math.cos(angle), hy: Math.sin(angle), think: 0, seed: rand(0, 1000) })
  }

  // -- Actions --------------------------------------------------------------

  split () {
    const [tx, ty] = this.target()
    const born = []
    const cells = [...this.cells].sort((a, b) => b.m - a.m)
    for (const cell of cells) {
      if (this.cells.length + born.length >= max_cells) break
      if (cell.m < min_split_mass) continue

      let dx = tx - cell.x
      let dy = ty - cell.y
      let d = Math.hypot(dx, dy)
      if (d < 1) {
        dx = cell.vx || 1
        dy = cell.vy
        d = Math.hypot(dx, dy) || 1
      }
      dx /= d
      dy /= d

      cell.m /= 2
      const r = radius_of(cell.m)
      born.push({
        x: cell.x + dx * r * 0.5,
        y: cell.y + dy * r * 0.5,
        m: cell.m,
        vx: cell.vx,
        vy: cell.vy,
        bx: dx * (640 + r * 1.5),
        by: dy * (640 + r * 1.5),
        seed: rand(0, 1000),
      })
      this.pulses.push({ x: cell.x, y: cell.y, age: 0, life: 0.4, speed: 300, cool: true })
    }
    this.cells.push(...born)
  }

  game_over () {
    this.state = 'over'
    this.state_time = 0
    this.action = null
    this.merging = false
    const peak = Math.round(this.peak)
    if (peak > this.best) {
      this.best = peak
      this.best_beaten = true
      this.store.set(best_key, this.best)
    }
  }

  // -- Simulation -----------------------------------------------------------

  update (dt) {
    this.time += dt
    this.state_time += dt
    this.flash = Math.max(0, this.flash - dt * 3)

    const playing = this.state === 'playing'
    if (playing) {
      this.elapsed += dt
      this.level = this.tier
      if (this.action && !this.merging && this.time - this.action.time > hold_time) this.merging = true
      this.move_cells(dt)
    }

    const count = Math.round(mix(10, 18, this.ramp))
    while (this.bots.length < count) this.spawn_bot()
    this.move_bots(dt)

    if (playing) {
      this.absorb()
      if (!this.cells.length) this.game_over()
    }

    for (const blob of [...this.cells, ...this.bots]) {
      if (blob.m > 150) blob.m -= blob.m * 0.002 * dt
    }

    if (this.cells.length) {
      const mass = this.mass
      this.peak = Math.max(this.peak, mass)
      this.score = Math.round(mass)

      const [cx, cy] = this.centroid()
      const follow = Math.min(1, dt * 6)
      this.cam.x += (cx - this.cam.x) * follow
      this.cam.y += (cy - this.cam.y) * follow
      this.scale += (this.target_scale() - this.scale) * Math.min(1, dt * 2)
    }

    for (const pulse of this.pulses) pulse.age += dt
    this.pulses = this.pulses.filter(pulse => pulse.age < pulse.life)
  }

  move_cells (dt) {
    const [tx, ty] = this.target()
    const [mx, my] = this.centroid()
    const cells = this.cells
    const ease = Math.min(1, dt * 8)
    const boost = Math.exp(-dt * 4)

    for (const cell of cells) {
      const v = speed_of(cell.m)
      let dx = tx - cell.x
      let dy = ty - cell.y
      let d = Math.hypot(dx, dy)
      // Full speed once the pointer is 90px away on screen.
      let pace = clamp(d * this.scale / 90)

      // Merging: every cell heads for the common center of mass instead.
      if (this.merging && cells.length > 1) {
        dx = mx - cell.x
        dy = my - cell.y
        d = Math.hypot(dx, dy)
        pace = 1.6 * clamp(d / 20)
      }

      let wx = d > 1 ? dx / d * v * pace : 0
      let wy = d > 1 ? dy / d * v * pace : 0
      // The joystick sets every cell's velocity directly.
      if (this.stick && !(this.merging && cells.length > 1)) {
        wx = this.stick.dx * v
        wy = this.stick.dy * v
      }
      cell.vx += (wx - cell.vx) * ease
      cell.vy += (wy - cell.vy) * ease
      cell.bx *= boost
      cell.by *= boost

      const r = radius_of(cell.m)
      cell.x = clamp(cell.x + (cell.vx + cell.bx) * dt, r, world_size - r)
      cell.y = clamp(cell.y + (cell.vy + cell.by) * dt, r, world_size - r)
    }

    for (let i = 0; i < cells.length; i++) {
      for (let j = i + 1; j < cells.length; j++) {
        const a = cells[i]
        const b = cells[j]
        if (a.m <= 0 || b.m <= 0) continue
        const dx = b.x - a.x
        const dy = b.y - a.y
        const d = Math.hypot(dx, dy) || 0.01
        const ra = radius_of(a.m)
        const rb = radius_of(b.m)

        if (this.merging) {
          // Fuse once the smaller one is mostly inside the bigger one.
          const [large, small, rl, rs] = a.m >= b.m ? [a, b, ra, rb] : [b, a, rb, ra]
          if (d < Math.max(rl * 0.6, rl - rs * 0.3)) {
            large.m += small.m
            small.m = 0
            this.pulses.push({ x: large.x, y: large.y, age: 0, life: 0.4, speed: 300, cool: true })
          }
          continue
        }

        // Otherwise your cells keep apart.
        const overlap = ra + rb - d
        if (overlap <= 0) continue
        const push = overlap * Math.min(1, dt * 10) / 2
        a.x -= dx / d * push
        a.y -= dy / d * push
        b.x += dx / d * push
        b.y += dy / d * push
      }
    }
    this.cells = cells.filter(cell => cell.m > 0)
  }

  // Signals flee what can absorb them, chase what they can absorb (you,
  // eagerly), graze on data bits, or wander.
  move_bots (dt) {
    const ramp = this.ramp
    const pace = mix(0.82, 0.95, ramp)
    const ease = Math.min(1, dt * 4)
    const others = [...this.cells, ...this.bots]

    for (const bot of this.bots) {
      bot.think -= dt
      if (bot.think <= 0) {
        bot.think = rand(0.25, 0.6)
        let threat = null
        let prey = null
        let threat_d = Infinity
        let prey_d = Infinity
        for (const other of others) {
          if (other === bot) continue
          const d = Math.hypot(other.x - bot.x, other.y - bot.y)
          if (other.m >= bot.m * eat_ratio && d < 300 + radius_of(other.m) && d < threat_d) {
            threat = other
            threat_d = d
          } else if (bot.m >= other.m * eat_ratio) {
            // Your cells look closer than they are.
            const seen = this.cells.includes(other) ? d * mix(0.8, 0.5, ramp) : d
            if (seen < 500 && seen < prey_d) {
              prey = other
              prey_d = seen
            }
          }
        }

        let goal = null
        let away = false
        if (threat) {
          goal = threat
          away = true
        } else if (prey) {
          goal = prey
        } else {
          let food_d = 400
          for (const bit of this.food) {
            const d = Math.abs(bit.x - bot.x) + Math.abs(bit.y - bot.y)
            if (d < food_d) {
              goal = bit
              food_d = d
            }
          }
        }

        if (goal) {
          const dx = goal.x - bot.x
          const dy = goal.y - bot.y
          const d = Math.hypot(dx, dy) || 1
          bot.hx = (away ? -dx : dx) / d
          bot.hy = (away ? -dy : dy) / d
        } else {
          const angle = Math.atan2(bot.hy, bot.hx) + rand(-0.8, 0.8)
          bot.hx = Math.cos(angle)
          bot.hy = Math.sin(angle)
        }
      }

      const v = speed_of(bot.m) * pace
      bot.vx += (bot.hx * v - bot.vx) * ease
      bot.vy += (bot.hy * v - bot.vy) * ease

      const r = radius_of(bot.m)
      bot.x += bot.vx * dt
      bot.y += bot.vy * dt
      if (bot.x < r || bot.x > world_size - r) bot.hx = -bot.hx
      if (bot.y < r || bot.y > world_size - r) bot.hy = -bot.hy
      bot.x = clamp(bot.x, r, world_size - r)
      bot.y = clamp(bot.y, r, world_size - r)
    }
  }

  absorb () {
    const blobs = [...this.cells, ...this.bots]
    const own = new Set(this.cells)
    // Data bits are worth more to you while you are small, for a quick start:
    // 4x at first, back to 1x by about 16 times the starting mass. It follows
    // your total mass, so splitting doesn't game it.
    const bonus = Math.max(1, 4 * Math.sqrt(start_mass / Math.max(start_mass, this.mass)))

    for (const blob of blobs) {
      const value = own.has(blob) ? bonus : 1
      const r = radius_of(blob.m)
      for (const bit of this.food) {
        const dx = bit.x - blob.x
        const dy = bit.y - blob.y
        if (dx > r || dx < -r || dy > r || dy < -r || dx * dx + dy * dy > r * r) continue
        blob.m += value
        bit.x = rand(0, world_size)
        bit.y = rand(0, world_size)
      }
    }

    for (const a of blobs) {
      if (a.m <= 0) continue
      for (const b of blobs) {
        if (a === b || b.m <= 0 || a.m < b.m * eat_ratio) continue
        if (own.has(a) && own.has(b)) continue
        const d = Math.hypot(a.x - b.x, a.y - b.y)
        if (d > radius_of(a.m) - radius_of(b.m) * 0.35) continue

        a.m += b.m
        b.m = 0
        if (own.has(b)) {
          this.flash = 1
          this.pulses.push({ x: b.x, y: b.y, age: 0, life: 0.8, speed: 320, cool: false })
        } else if (own.has(a)) {
          this.pulses.push({ x: b.x, y: b.y, age: 0, life: 0.5, speed: 300, cool: true })
        }
      }
    }

    this.cells = this.cells.filter(cell => cell.m > 0)
    this.bots = this.bots.filter(bot => bot.m > 0)
  }

  // -- Rendering ------------------------------------------------------------

  render (ctx) {
    this.draw_field(ctx)
    this.draw_button(ctx)
    this.draw_hud(ctx)
    if (this.state !== 'playing') this.draw_screen(ctx, this.stage.width, this.stage.height)
  }

  draw_field (ctx) {
    const { width, height } = this.stage
    const cell = this.cell
    const gap = width < 640 ? 3 : 4
    const columns = Math.ceil(width / cell)
    const rows = Math.ceil(height / cell)
    const time = this.time
    const flicker = Math.floor(time * 16)
    const scale = this.scale
    const cam = this.cam
    const playing = this.state === 'playing'

    // Data bits are single cells, so bin them by cell.
    if (this.food_at.length !== columns * rows) this.food_at = new Float32Array(columns * rows)
    const food_at = this.food_at
    food_at.fill(0)
    for (const bit of this.food) {
      const [x, y] = this.to_screen(bit.x, bit.y)
      if (x < 0 || y < 0 || x >= width || y >= height) continue
      food_at[Math.floor(y / cell) * columns + Math.floor(x / cell)] = 0.42 + 0.12 * Math.sin(time * 3 + bit.seed)
    }

    // Others are coloured by what they mean to you (once you are gone,
    // by what they would mean to a fresh start).
    const smallest = this.cells.length ? this.cells.reduce((m, c) => Math.min(m, c.m), Infinity) : start_mass
    const biggest = this.cells.reduce((m, c) => Math.max(m, c.m), 0)
    const blobs = []
    const add = (blob, kind) => {
      const [x, y] = this.to_screen(blob.x, blob.y)
      const r = radius_of(blob.m) * scale
      if (x + r < -cell || x - r > width + cell || y + r < -cell || y - r > height + cell) return
      blobs.push({ x, y, r, kind, seed: blob.seed })
    }
    for (const bot of this.bots) {
      const kind = bot.m >= smallest * eat_ratio ? 'threat' : biggest >= bot.m * eat_ratio ? 'edible' : 'neutral'
      add(bot, kind)
    }
    for (const own of this.cells) add(own, 'own')

    const pulses = this.pulses.map(pulse => {
      const [x, y] = this.to_screen(pulse.x, pulse.y)
      return { x, y, age: pulse.age, life: pulse.life, speed: pulse.speed, cool: pulse.cool }
    })

    const [left, top] = this.to_screen(0, 0)
    const [right, bottom] = this.to_screen(world_size, world_size)
    const button = this.button
    const pressed = !!this.action
    const stick = this.stick
    const stick_r = this.stick_radius
    const knob_r = stick_r * 0.42
    const knob_x = stick ? stick.x + stick.dx * (stick_r - knob_r) : 0
    const knob_y = stick ? stick.y + stick.dy * (stick_r - knob_r) : 0
    const merge_glow = this.merging ? 0.12 * Math.sin(time * 12) : 0

    this.stage.field.draw(ctx, width, height, (x, y, column, row, out) => {
      // The touch joystick, while a finger holds it: a dim base with a
      // brighter rim where the touch landed, and the knob.
      if (playing && stick) {
        if (Math.hypot(x - knob_x, y - knob_y) < knob_r) {
          out.level = 0.85
          out.color = colors.accent
          return
        }
        const from_base = Math.hypot(x - stick.x, y - stick.y)
        if (from_base < stick_r) {
          out.level = from_base > stick_r - cell ? 0.4 : 0.2
          out.color = colors.accent
          return
        }
      }
      // The split/merge button: a disc of accent cells, white while merging.
      if (playing && Math.hypot(x - button.x, y - button.y) < button.r) {
        out.level = pressed ? 0.85 : 0.55
        out.color = colors.accent
        if (this.merging) out.light = 0.8
        return
      }
      // Nothing beyond the edge of the world.
      if (x < left || x > right || y < top || y > bottom) {
        out.level = -1
        return
      }
      const wx = (x - width / 2) / scale + cam.x
      const wy = (y - height / 2) / scale + cam.y
      let level = ambient(wx / 700, wy / 700, time * 0.6) * 0.3
      let heat = 0
      let light = 0
      let color = null

      if (x - left < cell || right - x < cell || y - top < cell || bottom - y < cell) level = Math.max(level, 0.3)

      const bit = food_at[row * columns + column]
      if (bit > 0) {
        level = Math.max(level, bit)
        color = colors.food
      }

      for (let k = 0; k < blobs.length; k++) {
        const blob = blobs[k]
        const dx = x - blob.x
        const dy = y - blob.y
        const reach = blob.r + cell
        if (dx > reach || dx < -reach || dy > reach || dy < -reach) continue
        // A slightly wobbling membrane.
        const r = blob.r * (1 + 0.035 * Math.sin(Math.atan2(dy, dx) * 5 + time * 3 + blob.seed))
        const inside = clamp((r - Math.hypot(dx, dy)) / cell + 0.5)
        if (inside <= 0) continue
        const value = 0.3 + 0.65 * inside

        if (blob.kind === 'own') {
          light = Math.max(light, value + merge_glow)
        } else if (blob.kind === 'threat') {
          heat = Math.max(heat, value)
        } else if (value > level) {
          level = blob.kind === 'edible' ? value : value * 0.8
          color = blob.kind === 'edible' ? colors.edible : colors.neutral
        }
      }
      if (heat > 0.02) heat *= 0.7 + 0.4 * hash(column + flicker * 0.37, row)
      if (this.flash > 0 && light > 0) heat = Math.max(heat, this.flash * 0.8)

      for (let k = 0; k < pulses.length; k++) {
        const pulse = pulses[k]
        const front = Math.hypot(x - pulse.x, y - pulse.y) - pulse.age * pulse.speed
        const strength = Math.exp(-Math.abs(front) / 30) * (1 - pulse.age / pulse.life) * 0.8
        if (pulse.cool) level += strength
        else heat += strength
      }

      out.level = level
      out.heat = heat
      out.light = light
      out.color = color
    }, { cell, gap, anchor_x: 0, anchor_y: 0 })
  }

  draw_button (ctx) {
    if (this.state !== 'playing') return
    const button = this.button
    this.text(ctx, this.merging ? 'MERGE' : 'SPLIT', button.x, button.y + button.r + 14, {
      size: 10, weight: 700, color: colors.muted, align: 'center', spacing: '2px',
    })
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
      add('ACCUMULATOR', { size: title, weight: 800, spacing: '2px' }, title + 12)
      paragraph('You are white. Absorb the data and anything cool, avoid anything running hot.',
        { size: 16, weight: 500, color: colors.muted }, 34)
      paragraph('Steer with the mouse, or touch anywhere and drag. Right click, Space or the button splits; hold it to merge back.',
        { size: 14, weight: 500, color: colors.muted }, 26)
    } else {
      add(`ABSORBED  ·  SURVIVED ${Math.floor(this.elapsed)}s`, { size: 12, weight: 700, color: colors.danger, spacing: '3px' }, 0)
      add(String(Math.round(this.peak)), { size: title * 1.15, weight: 800 }, title * 1.15 + 12)
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
  id: 'accumulator',
  name: 'Accumulator',
  tagline: 'Absorb what is smaller, avoid what is bigger.',
  controls: 'Steer, split, merge',
  color: '#f2994a',
  available: true,
  icon: '<svg class="no-background" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="20" cy="26" r="13"/><circle cx="38" cy="14" r="6" opacity=".6"/><circle cx="38" cy="36" r="3" opacity=".6"/><circle cx="8" cy="8" r="2" opacity=".6"/></svg>',
  create: stage => new Accumulator(stage),
}
