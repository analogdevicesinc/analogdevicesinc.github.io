"use strict";

import { clamp, mix, hash, ambient, difficulty } from '../field.js'
import { text, wrap, hud, hud_bottom } from '../ui.js'

// Trace Router: pin pairs pop up on a PCB grid (the pixel field itself).
// Drag from a pin to its partner to route a trace, cell by cell, horizontal
// and vertical only. Traces can't cross each other.
//
// - Every waiting pair has a fuse; when it burns out the board loses health.
// - Shorter routes and quick successive connections score more.
// - Finished traces fade after a few seconds, so the board never jams.
// - Difficulty follows time survived on an ease-in-out curve that levels off
//   after a few minutes: pairs come faster, further apart and with shorter
//   fuses, and later noise hot-spots drift across the board, cutting any
//   trace they touch. From the plateau on it is a test of focus.

const rand = (min, max) => min + Math.random() * (max - min)

const max_integrity = 5
const tier_seconds = 15
// Seconds until the difficulty curve reaches its plateau.
const ramp_seconds = 180
const trace_life = 6
const trace_fade = 1
const combo_window = 3
// Bumped when the rules change, so old scores don't outlive a rebalance.
const best_key = 'best.v2'

const steps = [[1, 0], [-1, 0], [0, 1], [0, -1]]
// Pair colors stay clear of the warm palette (fuses and noise run hot) and
// of the field's own blues.
const pair_colors = ['#62c5dd', '#c1b4ef', '#f29ad8', '#9be27a', '#ffffff']

const colors = {
  text: '#e9eef5',
  muted: 'rgba(233, 238, 245, .62)',
  accent: '#62c5dd',
  gold: '#ffc36b',
  danger: '#ff6b6b',
  noise: '255, 122, 89',
  cool: '139, 215, 207',
}

class TraceRouter {
  constructor (stage) {
    this.stage = stage
    this.store = stage.storage('trace-router')
    this.best = Number(this.store.get(best_key, 0)) || 0
    this.time = 0
    this.state = 'ready'
    this.state_time = 0
    this.geometry = ''
    this.reset()
    this.layout()
  }

  get tier () { return 1 + Math.floor(this.elapsed / tier_seconds) }
  get ramp () { return difficulty(this.elapsed, ramp_seconds) }

  // Movement scales with the screen, so small screens keep the same timing.
  get pace_scale () {
    return clamp(Math.min(this.stage.width, this.stage.height) / 820, 0.45, 1.35)
  }

  reset () {
    this.score = 0
    this.elapsed = 0
    this.level = 1
    this.integrity = max_integrity
    this.combo = 0
    this.last_complete = -Infinity
    this.pulses = []
    this.ghosts = []
    this.spawn_timer = 0.3
    this.noise_timer = 0
    this.shake = 0
    this.flash = 0
    this.best_beaten = false
    this.next_id = 1
    this.color_index = 0
    this.clear_board()
  }

  clear_board () {
    this.pairs = []
    this.noises = []
    this.drag = null
    if (this.cols) {
      this.board = new Int32Array(this.cols * this.rows)
      this.pins = new Map()
    }
  }

  // Board geometry: cells at least 28px so a finger can hit them, leaving room
  // for the HUD on top. A geometry change (e.g. rotating a phone) clears it.
  layout () {
    const { width, height } = this.stage
    const cell = Math.round(clamp(Math.min(width, height) / 15, 28, 44))
    const top = hud_bottom
    const bottom = 24
    const side = 16
    const cols = Math.max(4, Math.floor((width - side * 2) / cell))
    const rows = Math.max(4, Math.floor((height - top - bottom) / cell))

    this.cell = cell
    this.cols = cols
    this.rows = rows
    this.bx = Math.round((width - cols * cell) / 2)
    this.by = Math.round(top + (height - top - bottom - rows * cell) / 2)

    const key = `${cell}:${cols}:${rows}`
    if (key !== this.geometry) {
      this.geometry = key
      this.glow = new Float32Array(cols * rows)
      this.heat = new Float32Array(cols * rows)
      this.tint = new Array(cols * rows).fill(null)
      this.clear_board()
    }
  }

  resize () {
    this.layout()
  }

  start () {
    this.reset()
    this.state = 'playing'
    this.state_time = 0
  }

  // -- Grid helpers ---------------------------------------------------------

  idx (c, r) { return r * this.cols + c }
  col (i) { return i % this.cols }
  row (i) { return Math.floor(i / this.cols) }
  inside (c, r) { return c >= 0 && c < this.cols && r >= 0 && r < this.rows }

  center (i) {
    return [this.bx + (this.col(i) + 0.5) * this.cell, this.by + (this.row(i) + 0.5) * this.cell]
  }

  free (i) {
    return this.board[i] === 0 && !this.pins.has(i) && !(this.drag && this.drag.path.includes(i))
  }

  hot (i) {
    const [x, y] = this.center(i)
    return this.noises.some(noise => Math.hypot(x - noise.x, y - noise.y) < noise.radius)
  }

  // Keep a one-cell margin around pins, so nothing gets boxed in.
  crowded (i) {
    const c = this.col(i)
    const r = this.row(i)
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (this.inside(c + dc, r + dr) && this.pins.has(this.idx(c + dc, r + dr))) return true
      }
    }
    return false
  }

  // Breadth-first route from a to b through empty cells, or null.
  route (a, b) {
    const prev = new Int32Array(this.cols * this.rows).fill(-2)
    const queue = [a]
    prev[a] = -1

    for (let q = 0; q < queue.length; q++) {
      const i = queue[q]
      if (i === b) break
      const c = this.col(i)
      const r = this.row(i)
      for (const [dc, dr] of steps) {
        if (!this.inside(c + dc, r + dr)) continue
        const j = this.idx(c + dc, r + dr)
        if (prev[j] !== -2) continue
        if (j !== b && (this.board[j] !== 0 || this.pins.has(j))) continue
        prev[j] = i
        queue.push(j)
      }
    }

    if (prev[b] === -2) return null
    const path = []
    for (let i = b; i !== -1; i = prev[i]) path.push(i)
    return path.reverse()
  }

  // -- Spawning -------------------------------------------------------------

  spawn_pair () {
    const ramp = this.ramp
    const dmax = Math.min(this.cols + this.rows - 2, Math.round(mix(6, 20, ramp)))
    const dmin = Math.min(dmax, Math.round(mix(3, 8, ramp)))

    for (let attempt = 0; attempt < 40; attempt++) {
      const a = Math.floor(Math.random() * this.board.length)
      if (!this.free(a) || this.crowded(a) || this.hot(a)) continue

      const distance = Math.round(rand(dmin, dmax))
      const dc = Math.round(rand(0, distance))
      const dr = distance - dc
      const c = this.col(a) + (Math.random() < 0.5 ? -dc : dc)
      const r = this.row(a) + (Math.random() < 0.5 ? -dr : dr)
      if (!this.inside(c, r)) continue

      const b = this.idx(c, r)
      if (b === a || !this.free(b) || this.crowded(b) || this.hot(b)) continue
      if (!this.route(a, b)) continue

      const fuse = mix(10, 5, ramp) + distance * 0.3
      const pair = {
        id: this.next_id++,
        color: pair_colors[this.color_index++ % pair_colors.length],
        a,
        b,
        ideal: distance,
        fuse,
        fuse_max: fuse,
        state: 'waiting',
        path: null,
        age: 0,
      }
      this.pairs.push(pair)
      this.pins.set(a, pair)
      this.pins.set(b, pair)
      return true
    }
    return false
  }

  spawn_noise () {
    const { bx, by, cell } = this
    const width = this.cols * cell
    const height = this.rows * cell
    const margin = cell * 2
    let x0, y0, x1, y1

    if (Math.random() < width / (width + height)) {
      const from_left = Math.random() < 0.5
      x0 = from_left ? bx - margin : bx + width + margin
      x1 = from_left ? bx + width + margin : bx - margin
      y0 = by + rand(0.1, 0.9) * height
      y1 = by + rand(0.1, 0.9) * height
    } else {
      const from_top = Math.random() < 0.5
      y0 = from_top ? by - margin : by + height + margin
      y1 = from_top ? by + height + margin : by - margin
      x0 = bx + rand(0.1, 0.9) * width
      x1 = bx + rand(0.1, 0.9) * width
    }

    const length = Math.hypot(x1 - x0, y1 - y0)
    const speed = mix(50, 120, this.ramp) * this.pace_scale
    this.noises.push({
      x: x0,
      y: y0,
      vx: (x1 - x0) / length * speed,
      vy: (y1 - y0) / length * speed,
      speed,
      length,
      travelled: 0,
      radius: cell * 1.15,
      seed: rand(0, 1000),
    })
  }

  // -- Input ----------------------------------------------------------------

  pointer (type, x, y) {
    if (this.state !== 'playing') {
      if (type !== 'down') return
      // Ignore clicks right after losing, so a last frantic drag doesn't
      // skip the score screen.
      if (this.state === 'over' && this.state_time < 0.9) return
      this.start()
      return
    }

    if (type === 'down') {
      this.begin(x, y)
    } else if (type === 'move') {
      if (!this.drag) return
      const c = clamp(Math.floor((x - this.bx) / this.cell), 0, this.cols - 1)
      const r = clamp(Math.floor((y - this.by) / this.cell), 0, this.rows - 1)
      this.extend(c, r)
    } else {
      this.release()
    }
  }

  // Pick the nearest waiting pin, with a generous radius for fingers.
  begin (x, y) {
    let best = null
    let best_distance = this.cell * 0.9
    for (const [i, pair] of this.pins) {
      if (pair.state !== 'waiting') continue
      const [px, py] = this.center(i)
      const distance = Math.hypot(px - x, py - y)
      if (distance < best_distance) {
        best = [i, pair]
        best_distance = distance
      }
    }
    if (!best) return

    const [i, pair] = best
    pair.state = 'routing'
    this.drag = { pair, path: [i], target: i === pair.a ? pair.b : pair.a }
  }

  // Walk the trace toward the pointer one cell at a time, so fast drags
  // don't skip cells. Moving onto the trace again undoes back to that cell.
  extend (tc, tr) {
    for (let guard = 0; guard < 96 && this.drag; guard++) {
      const path = this.drag.path
      const tail = path[path.length - 1]
      const c = this.col(tail)
      const r = this.row(tail)
      const dc = tc - c
      const dr = tr - r
      if (!dc && !dr) return

      const along_x = Math.abs(dc) >= Math.abs(dr)
      const first = along_x ? this.idx(c + Math.sign(dc), r) : this.idx(c, r + Math.sign(dr))
      if (this.step(first)) continue

      // Blocked: try the other axis before giving up.
      const other = along_x
        ? (dr ? this.idx(c, r + Math.sign(dr)) : -1)
        : (dc ? this.idx(c + Math.sign(dc), r) : -1)
      if (other < 0 || !this.step(other)) return
    }
  }

  step (i) {
    const drag = this.drag
    const path = drag.path

    if (path.length >= 2 && path[path.length - 2] === i) {
      path.pop()
      return true
    }
    const k = path.indexOf(i)
    if (k >= 0) {
      path.length = k + 1
      return true
    }
    if (i === drag.target) {
      path.push(i)
      this.complete()
      return true
    }
    if (!this.free(i) || this.hot(i)) return false
    path.push(i)
    return true
  }

  release () {
    if (!this.drag) return
    const { pair, path } = this.drag
    if (path.length > 1) this.ghosts.push({ path: path.slice(), color: pair.color, age: 0, life: 0.35 })
    pair.state = 'waiting'
    this.drag = null
  }

  // -- Outcomes -------------------------------------------------------------

  complete () {
    const { pair, path } = this.drag
    this.drag = null

    pair.state = 'done'
    pair.path = path.slice()
    pair.age = 0
    this.pins.delete(pair.a)
    this.pins.delete(pair.b)
    for (const i of pair.path) this.board[i] = pair.id

    const length = pair.path.length - 1
    const efficiency = clamp(pair.ideal / Math.max(1, length))
    this.combo = this.time - this.last_complete < combo_window ? Math.min(5, this.combo + 1) : 1
    this.last_complete = this.time

    const points = Math.round(40 * this.tier * (0.5 + efficiency) * this.combo)
    this.score += points

    const [ex, ey] = this.center(pair.path[pair.path.length - 1])
    this.pulses.push({ x: ex, y: ey, age: 0, life: 0.6, cool: true })
    this.burst(ex, ey, colors.cool)
  }

  burn (pair) {
    if (this.drag?.pair === pair) this.drag = null
    this.pins.delete(pair.a)
    this.pins.delete(pair.b)
    this.pairs = this.pairs.filter(entry => entry !== pair)
    this.combo = 0

    for (const i of [pair.a, pair.b]) {
      const [x, y] = this.center(i)
      this.pulses.push({ x, y, age: 0, life: 0.9, cool: false })
      this.burst(x, y, colors.noise)
    }

    this.integrity -= 1
    this.flash = 1
    this.shake = this.stage.reduced_motion() ? 0 : 0.45
    if (this.integrity <= 0) this.game_over()
  }

  remove_trace (pair) {
    for (const i of pair.path) {
      if (this.board[i] === pair.id) this.board[i] = 0
    }
    this.pairs = this.pairs.filter(entry => entry !== pair)
  }

  cut (pair, x, y) {
    this.remove_trace(pair)
    const penalty = 20 * this.tier
    this.score = Math.max(0, this.score - penalty)
    this.combo = 0
    this.burst(x, y, colors.noise)
  }

  // Noise cuts finished traces it touches and trims the trace being drawn.
  noise_hits () {
    const { cell, bx, by } = this
    for (const noise of this.noises) {
      const reach = noise.radius * 0.85
      const c0 = Math.max(0, Math.floor((noise.x - reach - bx) / cell))
      const c1 = Math.min(this.cols - 1, Math.floor((noise.x + reach - bx) / cell))
      const r0 = Math.max(0, Math.floor((noise.y - reach - by) / cell))
      const r1 = Math.min(this.rows - 1, Math.floor((noise.y + reach - by) / cell))

      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const i = this.idx(c, r)
          const [x, y] = this.center(i)
          if (Math.hypot(x - noise.x, y - noise.y) > reach) continue

          const id = this.board[i]
          if (id > 0) {
            const pair = this.pairs.find(entry => entry.id === id)
            if (pair) this.cut(pair, x, y)
          }

          if (this.drag) {
            const k = this.drag.path.indexOf(i)
            if (k === 0) {
              this.release()
            } else if (k > 0) {
              this.drag.path.length = k
              this.burst(x, y, colors.noise)
            }
          }
        }
      }
    }
  }

  game_over () {
    this.state = 'over'
    this.state_time = 0
    this.drag = null
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

    if (this.state === 'playing') {
      this.elapsed += dt
      const t = this.elapsed

      this.level = this.tier

      // Never leave the player idle with nothing to route.
      if (!this.pairs.some(pair => pair.state !== 'done')) this.spawn_timer = Math.min(this.spawn_timer, 0.5)

      this.spawn_timer -= dt
      if (this.spawn_timer <= 0) {
        const spawned = this.spawn_pair()
        this.spawn_timer = spawned ? mix(3, 1, this.ramp) * rand(0.8, 1.2) : 0.4
      }

      if (t > 30) {
        this.noise_timer -= dt
        if (this.noise_timer <= 0) {
          this.spawn_noise()
          this.noise_timer = mix(6, 2.8, this.ramp) * rand(0.8, 1.2)
        }
      }

      for (const pair of [...this.pairs]) {
        if (this.state !== 'playing') break
        if (pair.state === 'done') {
          pair.age += dt
          if (pair.age > trace_life) this.remove_trace(pair)
        } else {
          pair.fuse -= dt
          if (pair.fuse <= 0) this.burn(pair)
        }
      }

      this.noise_hits()
    }

    for (const noise of this.noises) {
      noise.x += noise.vx * dt
      noise.y += noise.vy * dt
      noise.travelled += noise.speed * dt
    }
    this.noises = this.noises.filter(noise => noise.travelled < noise.length)

    for (const list of [this.pulses, this.ghosts]) {
      for (const entry of list) entry.age += dt
    }
    this.pulses = this.pulses.filter(entry => entry.age < entry.life)
    this.ghosts = this.ghosts.filter(entry => entry.age < entry.life)
  }

  // -- Rendering ------------------------------------------------------------

  render (ctx) {
    const { width, height } = this.stage

    ctx.save()
    if (this.shake > 0) {
      ctx.translate((Math.random() - 0.5) * 12 * this.shake, (Math.random() - 0.5) * 12 * this.shake)
    }
    this.build_cells()
    this.draw_field(ctx, width, height)
    ctx.restore()

    this.draw_hud(ctx)
    if (this.state !== 'playing') this.draw_screen(ctx, width, height)
  }

  // Everything on the board is a field cell: per cell, a level, a heat and
  // the pair color it belongs to. Later marks only win when brighter.
  //
  // - Airwire: marching dotted cells between the two pins of a pair.
  // - Pin: a single cell that shrinks as its fuse burns, and flickers hot
  //   when it is about to blow.
  // - Trace: a row of cells in the pair color, the one being drawn brighter.
  build_cells () {
    const { glow, heat, tint } = this
    glow.fill(0)
    heat.fill(0)
    tint.fill(null)

    const mark = (i, level, color) => {
      if (level <= glow[i]) return
      glow[i] = level
      tint[i] = color
    }
    const march = Math.floor(this.time * 5)
    const blink = Math.floor(this.time * 6) % 2 === 0

    for (const pair of this.pairs) {
      if (pair.state === 'done') continue
      const ac = this.col(pair.a)
      const ar = this.row(pair.a)
      const dc = this.col(pair.b) - ac
      const dr = this.row(pair.b) - ar
      const steps = Math.max(Math.abs(dc), Math.abs(dr))
      for (let k = 1; k < steps; k++) {
        if ((k + march) % 3) continue
        const i = this.idx(Math.round(ac + dc * k / steps), Math.round(ar + dr * k / steps))
        mark(i, pair.state === 'routing' ? 0.16 : 0.3, pair.color)
      }
    }

    for (const ghost of this.ghosts) {
      const level = 0.5 * (1 - ghost.age / ghost.life)
      for (const i of ghost.path) mark(i, level, ghost.color)
    }

    for (const pair of this.pairs) {
      if (pair.state === 'done') {
        const level = 0.62 * clamp((trace_life - pair.age) / trace_fade)
        for (const i of pair.path) mark(i, level, pair.color)
        continue
      }

      const ratio = clamp(pair.fuse / pair.fuse_max)
      for (const end of [pair.a, pair.b]) {
        mark(end, 0.6 + 0.4 * ratio, pair.color)
        if (ratio < 0.3 && blink) heat[end] = 0.5 + (1 - ratio / 0.3) * 0.5
      }
    }

    if (this.drag) {
      const { pair, path, target } = this.drag
      for (const i of path) mark(i, 0.92, pair.color)
      // The pin to reach breathes.
      glow[target] = 0.7 + 0.3 * Math.sin(this.time * 8)
    }
  }

  draw_field (ctx, width, height) {
    const { bx, by, cell, cols, rows, glow, heat, tint, noises, pulses } = this
    const time = this.time
    const flicker = Math.floor(time * 16)

    this.stage.field.draw(ctx, width, height, (x, y, column, row, out) => {
      const c = Math.floor((x - bx) / cell)
      const r = Math.floor((y - by) / cell)
      const on_board = c >= 0 && c < cols && r >= 0 && r < rows
      // The board reads as a brighter patch of the field.
      let level = ambient(x / width, y / height, time) * (on_board ? 0.38 : 0.2)
      let hot = 0

      if (on_board) {
        const i = r * cols + c
        if (glow[i] > 0) {
          level = glow[i]
          out.color = tint[i]
        }
        hot = heat[i]
      }

      for (let k = 0; k < noises.length; k++) {
        const noise = noises[k]
        const dx = x - noise.x
        const dy = y - noise.y
        const reach = noise.radius * 2.4
        if (dx > reach || dx < -reach || dy > reach || dy < -reach) continue
        const sigma = noise.radius * 0.9
        hot += Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma))
      }
      if (hot > 0.02) hot *= 0.6 + 0.55 * hash(column + flicker * 0.37, row)

      for (let k = 0; k < pulses.length; k++) {
        const pulse = pulses[k]
        const front = Math.hypot(x - pulse.x, y - pulse.y) - pulse.age * (pulse.speed ?? 420)
        const strength = Math.exp(-Math.abs(front) / 30) * (1 - pulse.age / pulse.life) * 0.8
        if (pulse.cool) level += strength
        else hot += strength
      }

      out.level = level
      out.heat = hot
    }, { cell, gap: Math.round(cell * 0.16), anchor_x: bx, anchor_y: by })
  }

  draw_hud (ctx) {
    hud(ctx, this.stage.font, this.stage.width, {
      score: this.score,
      level: this.level,
      elapsed: this.elapsed,
      best: this.best,
      playing: this.state === 'playing',
      lives: this.integrity,
      lives_max: max_integrity,
      hurt: this.flash > 0,
    })
  }

  draw_screen (ctx, width, height) {
    ctx.fillStyle = 'rgba(7, 11, 18, .78)'
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
      add('TRACE ROUTER', { size: title, weight: 800, spacing: '2px' }, title + 12)
      paragraph('Drag from a pin to its matching partner to route a trace. Traces can\u2019t cross each other.',
        { size: 16, weight: 500, color: colors.muted }, 34)
      paragraph('Connect each pair before its fuse burns out. Shorter routes score more. It gets faster every second.',
        { size: 14, weight: 500, color: colors.muted }, 26)
    } else {
      add(`BOARD FRIED  ·  SURVIVED ${Math.floor(this.elapsed)}s`, { size: 12, weight: 700, color: colors.danger, spacing: '3px' }, 0)
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
  id: 'trace-router',
  name: 'Trace Router',
  tagline: 'Connect the pins before their fuses burn.',
  controls: 'Drag to route',
  color: '#d4adf0',
  available: true,
  icon: '<svg class="no-background" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="12" r="3"/><circle cx="40" cy="36" r="3"/><path d="M11 12h12l8 8v13h6"/><circle cx="8" cy="36" r="3"/><circle cx="40" cy="12" r="3"/><path d="M11 36h6l4-4v-8l8-12h8"/></svg>',
  create: stage => new TraceRouter(stage),
}
