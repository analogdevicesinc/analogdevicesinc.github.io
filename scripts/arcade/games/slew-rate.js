"use strict";

import { clamp, mix, hash, ambient, difficulty, plane_step } from '../field.js'
import { text, wrap, hud, hud_bottom } from '../ui.js'

// Slew Rate: a kart race down a curving road, the pixel field laid in
// perspective. The car drives itself flat out; you steer, dodge the blocks
// and hit the boost pads. Every few seconds the last cars of the pack are
// cut from the race: be the last one standing to win it, then the next race
// starts, faster.
//
// - The pack races like Mario Kart: every rival keeps a slot around you, ahead
//   or behind, swaying so places swap back and forth. Driving clean keeps you
//   clear of the cut; a crash drops you places, and the rivals only wait a
//   little, so a crash right before a cut can cost the race.
// - Blocks slow you down hard. Bumping a rival pushes you both aside.
// - Curves push the car outward. Speed, blocks and cuts follow an
//   ease-in-out difficulty curve that levels off.

const road = 12
// Field cells drawn on either side of the rails.
const margin = 9
const car_width = 4
const car_rows = 4
const block_width = 3
const block_rows = 3
const pad_width = 5
const pad_rows = 2
const z_near = 1
const z_player = 1.4
const z_far = 24
// How much the camera follows the car across.
const follow = 0.35
const racers = 9
const cut_count = 2
// Gap between the rivals' slots, in depth units.
const slot = 0.9
const ramp_seconds = 180
const steer_speed = 21
const best_key = 'best'

// Rivals, in ADI hues; warm colors are for the blocks.
const car_colors = ['#92befc', '#d4adf0', '#62c5dd', '#8bd7cf', '#c1b4ef', '#6e8ef2', '#b16ee0', '#7fd1ae']
const rainbow = Array.from({ length: 36 }, (_, i) => `hsl(${i * 10}, 85%, 65%)`)

const colors = {
  text: '#e9eef5',
  muted: 'rgba(233, 238, 245, .62)',
  accent: '#62c5dd',
  danger: '#ff6b6b',
  gold: '#ffc36b',
}

// The road's center across, by distance along it: two slow bends. `bend` is
// its second derivative, how hard the road turns there.
const waves = [[46, 4.8, 0], [18, 2.7, 1.3]]
const center = d => waves.reduce((sum, [a, l, p]) => sum + a * Math.sin(d / l + p), 0)
const slope = d => waves.reduce((sum, [a, l, p]) => sum + a / l * Math.cos(d / l + p), 0)
const bend = d => waves.reduce((sum, [a, l, p]) => sum - a / (l * l) * Math.sin(d / l + p), 0)
const bend_max = waves.reduce((sum, [a, l]) => sum + a / (l * l), 0)

class SlewRate {
  constructor (stage) {
    this.stage = stage
    this.store = stage.storage('slew-rate')
    this.best = Number(this.store.get(best_key, 0)) || 0
    this.time = 0
    this.state = 'ready'
    this.state_time = 0
    this.steer_keys = { left: false, right: false }
    this.target = null
    this.next_id = 1
    this.reset()
  }

  get ramp () { return difficulty(this.elapsed, ramp_seconds) }
  get top () { return mix(6, 10.5, this.ramp) }
  get cut_every () { return mix(12, 9, this.ramp) }
  get active () { return this.cars.filter(car => !car.out) }
  get rank () { return this.ranked().indexOf(this.player) + 1 }
  // Cars cut next time: never the last one standing.
  get cut_size () { return Math.min(cut_count, this.active.length - 1) }

  reset () {
    this.score = 0
    this.elapsed = 0
    this.race = 1
    this.player = { id: 0, player: true, x: 0, d: 0, v: 0, vx: 0, boost: 0, hurt: -Infinity, bumped: -Infinity }
    this.cars = [this.player]
    this.obstacles = []
    this.ripples = []
    this.next_spawn = 6
    this.next_pad = 14
    this.cut_timer = this.cut_every
    this.next_race = null
    this.flash = 0
    this.shake = 0
    this.party = 0
    this.best_beaten = false
    this.target = null

    // The starting grid, three by three, you in the middle.
    let k = 0
    for (const d of [0.7, 0, -0.7]) {
      for (const x of [-7, 0, 7]) {
        if (d === 0 && x === 0) continue
        this.cars.push(this.rival(x, d, car_colors[k++ % car_colors.length]))
      }
    }
    this.assign_slots()
  }

  rival (x, d, color) {
    return {
      id: this.next_id++,
      x,
      d,
      v: 0,
      vx: 0,
      color,
      aim: x,
      wobble: 1.1,
      rate: Math.PI * 2 / mix(4, 7, Math.random()),
      phase: Math.random() * Math.PI * 2,
      slot: 0,
      wander: 2 + Math.random() * 3,
      hurt: -Infinity,
      bumped: -Infinity,
      boost: 0,
      out: false,
    }
  }

  // Each rival keeps a slot around you, a few more behind than ahead, so
  // driving clean keeps you a crash or two clear of the cut. Before the final cut
  // they all line up just behind you, to fight for the win.
  assign_slots () {
    const rivals = this.ranked().filter(car => !car.player)
    const final = this.active.length - this.cut_size <= 1
    const ahead = final ? 0 : Math.floor((rivals.length - 1) / 2)
    rivals.forEach((car, i) => {
      car.slot = i < ahead ? (ahead - i) * slot : -(i - ahead + 1) * slot
      if (final) car.slot += 0.1
    })
  }

  ranked () {
    return this.active.sort((a, b) => b.d - a.d)
  }

  start () {
    this.reset()
    this.state = 'playing'
    this.state_time = 0
  }

  // -- Input ----------------------------------------------------------------

  // A mouse is followed; a touch sends the car under the finger, and
  // dragging steers it along.
  pointer (type, x, y, event) {
    const mouse = event.pointerType === 'mouse'
    if (type === 'down' && this.state !== 'playing') {
      this.try_start()
      return
    }
    if (type === 'down' || (type === 'move' && (mouse || event.buttons))) {
      this.target = this.to_track(x)
    }
  }

  key (type, event) {
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
    const side = { ArrowLeft: 'left', a: 'left', ArrowRight: 'right', d: 'right' }[key]
    if (!side && key !== ' ' && key !== 'Enter') return false
    if (side) {
      this.steer_keys[side] = type === 'down'
      this.target = null
    }
    if (type !== 'down' || event.repeat) return true
    if (this.state !== 'playing') this.try_start()
    return true
  }

  try_start () {
    // Ignore presses right after losing, so frantic steering doesn't skip the
    // score screen.
    if (this.state === 'over' && this.state_time < 0.9) return
    this.start()
  }

  // Screen x to a position across the road, where the car would sit under it.
  to_track (px) {
    const { unit } = this.layout()
    const u = (px - this.stage.width / 2) * z_player / unit
    return clamp(u / (1 - follow), -road, road)
  }

  // -- Simulation -----------------------------------------------------------

  update (dt) {
    this.time += dt
    this.state_time += dt
    this.flash = Math.max(0, this.flash - dt * 3)
    this.shake = Math.max(0, this.shake - dt * 2.4)
    this.party = Math.max(0, this.party - dt / 3)
    for (const ripple of this.ripples) ripple.age += dt
    this.ripples = this.ripples.filter(ripple => ripple.age < ripple.life)

    if (this.state !== 'playing') return

    this.elapsed += dt
    const step = plane_step(this.layout())
    // Lengths in depth of a car and a block, matching their rows at the car.
    this.car_length = car_rows * step * z_player
    this.block_length = block_rows * step * z_player
    this.pad_length = pad_rows * step * z_player

    this.drive_player(dt)
    for (const car of this.active) if (!car.player) this.drive_rival(car, dt)
    this.collide_cars()
    this.spawn()
    this.obstacles = this.obstacles.filter(o => o.d > this.player.d - 6 && !o.gone)
    this.score += this.player.v * dt * 10

    if (this.next_race !== null) {
      this.next_race -= dt
      if (this.next_race <= 0) this.new_race()
    } else {
      this.cut_timer -= dt
      if (this.cut_timer <= 0) this.cut()
    }
  }

  drive_player (dt) {
    const car = this.player
    const top = this.top
    // Flat out, always: back up to speed after a crash, down after a boost.
    if (car.v < top) car.v = Math.min(top, car.v + top * 0.6 * dt)
    else car.v = Math.max(top, car.v - top * 0.45 * dt)

    let dx = 0
    if (this.target !== null) dx = clamp(this.target - car.x, -steer_speed * dt, steer_speed * dt)
    if (this.steer_keys.left) dx -= steer_speed * dt
    if (this.steer_keys.right) dx += steer_speed * dt
    // Curves push outward.
    dx -= bend(car.d) / bend_max * 4.5 * (car.v / top) * dt
    this.move(car, dx, dt)
  }

  drive_rival (car, dt) {
    const top = this.top
    const gap = car.d - this.player.d
    // Rubber band: it heads for its slot, swaying around it. It catches up
    // fast, but only waits a little.
    const want = car.slot + car.wobble * Math.sin(this.elapsed * car.rate + car.phase)
    const pace = top * (1 + clamp((want - gap) * 0.35, -0.12, 0.25)) * (1 + car.boost * 0.45)
    car.boost = Math.max(0, car.boost - dt)
    const accel = top * 0.6
    car.v = car.v < pace ? Math.min(pace, car.v + accel * dt) : Math.max(pace, car.v - accel * dt)

    // Picks a line: wanders now and then, keeps clear of blocks just ahead
    // (mostly) and of slower cars.
    car.wander -= dt
    if (car.wander <= 0) {
      car.aim = clamp(car.aim + (Math.random() - 0.5) * 12, -road + 3, road - 3)
      car.wander = 2 + Math.random() * 3
    }
    if (this.blocked(car, car.aim)) {
      let best = car.aim
      for (const offset of [3, -3, 6, -6, 9, -9, 12, -12]) {
        const aim = clamp(car.x + offset, -road + 2.5, road - 2.5)
        if (!this.blocked(car, aim)) {
          best = aim
          break
        }
      }
      car.aim = best
    }
    const dx = clamp(car.aim - car.x, -12 * dt, 12 * dt)
    this.move(car, dx, dt)
  }

  // Whether a line across is blocked just ahead of a car.
  blocked (car, aim) {
    const look = this.top * 0.5
    for (const o of this.obstacles) {
      if (o.kind === 'pad') continue
      const ahead = o.d - car.d
      if (ahead < 0 || ahead > look) continue
      // Rivals miss now and then, so the race looks fair.
      if (hash(o.id, car.id) < 0.12) continue
      if (Math.abs(o.x - aim) < (car_width + block_width) / 2 + 0.8) return true
    }
    for (const other of this.active) {
      if (other === car) continue
      const ahead = other.d - car.d
      if (ahead > 0 && ahead < 0.7 && other.v < car.v && Math.abs(other.x - aim) < car_width + 0.5) return true
    }
    return false
  }

  // Moves a car on, against the rails, and checks what it ran over.
  move (car, dx, dt) {
    const limit = road - car_width / 2
    const before = car.d
    car.vx *= Math.exp(-6 * dt)
    car.x += dx + car.vx * dt
    if (Math.abs(car.x) > limit) {
      car.x = Math.sign(car.x) * limit
      car.vx = 0
      // Scraping the rail slows you down a little.
      car.v *= 1 - 0.4 * dt
    }
    car.d += car.v * dt

    for (const o of this.obstacles) {
      if (o.gone) continue
      const width = o.kind === 'pad' ? pad_width : block_width
      const length = o.kind === 'pad' ? this.pad_length : this.block_length
      if (Math.abs(o.x - car.x) > (car_width + width) / 2 - 0.4) continue
      if (car.d + this.car_length / 2 < o.d - length / 2 || before - this.car_length / 2 > o.d + length / 2) continue
      if (o.kind === 'pad') {
        if (o.used?.has(car.id)) continue
        o.used = (o.used ?? new Set()).add(car.id)
        car.boost = 1
        if (car.player) {
          car.v = Math.max(car.v, this.top * 1.45)
          this.score += 25 * this.race
          this.ripples.push({ x: car.x, d: car.d, age: 0, life: 0.9, speed: 30, strength: 0.7, light: true })
        }
        continue
      }
      if (this.time - car.hurt < 0.8) continue
      this.crash(car, o)
    }
  }

  crash (car, o) {
    car.hurt = this.time
    car.v *= 0.35
    o.gone = true
    this.ripples.push({ x: o.x, d: o.d, age: 0, life: 0.9, speed: 22, strength: car.player ? 0.9 : 0.6, hot: true })
    if (car.player) {
      this.flash = 1
      this.shake = this.stage.reduced_motion() ? 0 : 0.45
    }
  }

  // Cars that touch push each other aside; the one behind loses a little.
  collide_cars () {
    const cars = this.active
    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) {
        const a = cars[i]
        const b = cars[j]
        const dx = b.x - a.x
        if (Math.abs(dx) >= car_width || Math.abs(b.d - a.d) >= this.car_length) continue
        const side = dx === 0 ? (Math.random() < 0.5 ? -1 : 1) : Math.sign(dx)
        const push = (car_width - Math.abs(dx)) / 2
        a.x -= side * push
        b.x += side * push
        if (this.time - a.bumped < 0.25 && this.time - b.bumped < 0.25) continue
        a.vx = -side * 9
        b.vx = side * 9
        a.bumped = b.bumped = this.time
        const behind = a.d < b.d ? a : b
        behind.v *= 0.92
        if (a.player || b.player) {
          this.ripples.push({ x: (a.x + b.x) / 2, d: (a.d + b.d) / 2, age: 0, life: 0.6, speed: 18, strength: 0.5, light: true })
          if (!this.stage.reduced_motion()) this.shake = Math.max(this.shake, 0.18)
        }
      }
    }
  }

  // Lays blocks and boost pads ahead, out of sight.
  spawn () {
    const ramp = this.ramp
    const ahead = this.player.d + z_far - z_player - 2
    while (this.next_spawn < ahead) {
      const d = this.next_spawn
      const first = this.place(d, 'block')
      // Sometimes a second one beside it, leaving a gap to drive through.
      if (Math.random() < mix(0.05, 0.35, ramp)) this.place(d, 'block', first.x)
      this.next_spawn += this.top * mix(0.75, 0.36, ramp) * (0.7 + Math.random() * 0.6)
    }
    while (this.next_pad < ahead) {
      this.place(this.next_pad, 'pad')
      this.next_pad += this.top * (2.5 + Math.random() * 2)
    }
  }

  place (d, kind, beside = null) {
    const edge = road - 2.5
    let x = Math.round(mix(-edge, edge, Math.random()))
    if (beside !== null) {
      for (let tries = 0; tries < 8 && Math.abs(x - beside) < car_width + block_width + 2; tries++) {
        x = Math.round(mix(-edge, edge, Math.random()))
      }
    }
    const o = { id: this.next_id++, kind, x, d, gone: false }
    this.obstacles.push(o)
    return o
  }

  cut () {
    const rank = this.rank
    const field = this.active.length
    const losers = this.ranked().slice(-this.cut_size)
    for (const car of losers) {
      car.out = true
      this.ripples.push({ x: car.x, d: car.d, age: 0, life: 1, speed: 20, strength: 0.8, hot: true })
    }
    if (losers.includes(this.player)) {
      this.game_over(rank, field)
      return
    }
    this.score += 100 * this.race
    // A white sweep down the road: you made it through.
    this.ripples.push({ x: this.player.x, d: this.player.d, age: 0, life: 1.4, speed: 40, strength: 0.5, light: true })
    this.cars = this.active
    if (this.cars.length === 1) {
      // Last one standing: the road throws a party, then a new pack arrives.
      this.score += 500 * this.race
      this.party = 1
      this.next_race = 3
      return
    }
    this.assign_slots()
    this.cut_timer = this.cut_every
  }

  // A fresh pack catches up from behind for the next race.
  new_race () {
    this.race += 1
    this.next_race = null
    for (let k = 0; k < racers - 1; k++) {
      const car = this.rival(mix(-8, 8, (k % 3) / 2), this.player.d - 1.5 - Math.floor(k / 3) * 1.2, car_colors[k % car_colors.length])
      car.v = this.top
      this.cars.push(car)
    }
    this.assign_slots()
    this.cut_timer = this.cut_every + 2
  }

  game_over (rank, field) {
    this.state = 'over'
    this.state_time = 0
    this.final_rank = rank
    this.final_field = field
    this.score = Math.floor(this.score)
    if (this.score > this.best) {
      this.best = this.score
      this.best_beaten = true
      this.store.set(best_key, this.best)
    }
    this.flash = 1
  }

  // -- Rendering ------------------------------------------------------------

  render (ctx) {
    ctx.save()
    if (this.shake > 0) {
      ctx.translate((Math.random() - 0.5) * 12 * this.shake, (Math.random() - 0.5) * 12 * this.shake)
    }
    this.draw_field(ctx)
    ctx.restore()
    this.draw_hud(ctx)
    if (this.state !== 'playing') this.draw_screen(ctx, this.stage.width, this.stage.height)
  }

  draw_field (ctx) {
    const { width, height } = this.stage
    const time = this.time
    const player = this.player
    const layout = this.layout()
    const step = plane_step(layout)
    const log_step = Math.log(1 + step)
    const row_of = z => Math.log(z / z_near) / log_step
    const origin = -road - margin
    const base = player.d
    const base_center = center(base)
    const base_slope = slope(base)
    const camera = player.x * follow
    // Rows slide across with the road's bend ahead, relative to its heading
    // at the car, and against the camera.
    layout.shift = z => {
      const ahead = z - z_player
      return center(base + ahead) - base_center - base_slope * ahead - camera
    }
    const depth_cells = 1 / (step * z_player)
    const warning = this.state === 'playing' && this.next_race === null && this.cut_timer < 3
    const blink = Math.sin(time * 14) > 0
    const cut_from = this.active.length - this.cut_size
    const in_danger = warning && this.rank > cut_from
    const party = this.party
    const flicker = Math.floor(time * 16)

    // Everything on the road as boxes of rows and columns, back to front so
    // nearer ones win.
    const boxes = []
    const add = (x, d, columns, rows, style) => {
      const z = z_player + d - base
      if (z < z_near * 0.8 || z > z_far) return
      const left = Math.round(x - columns / 2) - origin
      const row = row_of(z)
      boxes.push({ c0: left, c1: left + columns - 1, r0: row - rows / 2, r1: row + rows / 2, z, ...style })
    }
    for (const o of this.obstacles) {
      if (o.gone) continue
      if (o.kind === 'pad') {
        add(o.x, o.d, pad_width, pad_rows, { light: 0.35 + 0.25 * Math.sin(time * 10 + o.id), level: 0.5 })
      } else {
        add(o.x, o.d, block_width, block_rows, { heat: 0.75 })
      }
    }
    for (const car of this.active) {
      const hurt = time - car.hurt < 0.8 && blink
      const bumped = clamp(1 - (time - car.bumped) / 0.25)
      if (car.player) {
        // A white light trail while boosting.
        if (car.v > this.top * 1.02) {
          const trail = clamp((car.v / this.top - 1) / 0.45)
          add(car.x, car.d - this.car_length * 1.1, 2, car_rows, { light: 0.5 * trail })
        }
        add(car.x, car.d, car_width, car_rows, in_danger && blink ? { heat: 0.85 } : hurt ? { heat: 0.7 } : { light: 0.95 })
      } else {
        const doomed = warning && this.ranked().indexOf(car) >= cut_from && blink
        add(car.x, car.d, car_width, car_rows, doomed || hurt ? { heat: 0.7 } : { color: car.color, level: 0.95, light: bumped * 0.6 })
      }
    }
    boxes.sort((a, b) => b.z - a.z)
    const ripples = this.ripples

    this.stage.field.draw_plane(ctx, width, height, (u, z, column, row, out) => {
      const x = origin + column
      const d = base + z - z_player
      const fog = mix(0.4, 1, clamp(1 - (z - z_near) / 12))
      const fade = 1 - clamp((z - 6) / (z_far - 10))
      const on_road = x > -road && x < road
      const rail = x === -road || x === road

      const wave = ambient(x * 0.12, d * 0.45, time * 0.5)
      let level = on_road ? 0.2 + wave * 0.42 : wave * 0.24
      let heat = 0
      let light = 0
      let color = null

      if (rail) {
        // Curbs, striped by distance so speed shows.
        const stripe = Math.floor(d / 0.7) & 1
        level = 0.65
        if (stripe) light = 0.55
        else color = '#62c5dd'
        if (in_danger) heat = blink ? 0.8 : 0.3
      } else if ((x === -4 || x === 4) && Math.floor(d / 0.5) % 3 === 0) {
        level = Math.max(level, 0.6)
      }

      // A race won turns the road into a rainbow for a while.
      if (on_road && party > 0.02 && wave > 1 - party * 1.2) {
        const band = Math.log(z) * 2.2 + Math.sin(x * 0.3 + time * 2) * 0.35 - time * 0.6
        color = rainbow[Math.floor((band - Math.floor(band)) * rainbow.length)]
        level = Math.max(level, 0.3 + 0.3 * party * wave)
      }

      for (let k = 0; k < ripples.length; k++) {
        const ripple = ripples[k]
        const front = Math.hypot(x - ripple.x, (d - ripple.d) * depth_cells) - ripple.age * ripple.speed
        if (front > 1.5 || front < -1.5) continue
        const strength = Math.exp(-Math.abs(front) / 0.7) * (1 - ripple.age / ripple.life) * ripple.strength
        if (ripple.hot) heat += strength
        else if (ripple.light) light += strength
        else level += strength
      }

      for (let k = 0; k < boxes.length; k++) {
        const box = boxes[k]
        if (column < box.c0 || column > box.c1 || row < box.r0 || row >= box.r1) continue
        level = box.level ?? 0.9
        heat = box.heat ?? 0
        light = box.light ?? 0
        color = box.color ?? null
      }
      if (heat > 0.02) heat *= 0.7 + 0.4 * hash(column + flicker * 0.37, row)

      out.level = level * fog
      out.heat = heat
      out.light = light
      out.color = color
      out.alpha = fade * fade * (3 - 2 * fade)
    }, layout)
  }

  layout () {
    const { width, height } = this.stage
    // Cell size at the car: the whole road and a little more fits across.
    const cell_px = Math.min(width / (2 * road + 6), height / 24, 28)
    return {
      horizon: Math.max(hud_bottom + 16, height * 0.24),
      near_y: height + 4,
      unit: cell_px * z_player,
      cell: 1,
      u_start: -road - margin,
      columns: 2 * (road + margin) + 1,
      z_near,
      z_far,
    }
  }

  draw_hud (ctx) {
    const playing = this.state === 'playing'
    let status = `RACE ${this.race}`
    let alert = false
    if (playing && this.next_race !== null) {
      status = `RACE ${this.race} WON`
    } else if (playing) {
      const cut_from = this.active.length - this.cut_size
      status = `P${this.rank} OF ${this.active.length}  ·  RACE ${this.race}`
      alert = this.rank > cut_from
    }
    hud(ctx, this.stage.font, this.stage.width, {
      score: Math.floor(this.score),
      best: this.best,
      playing,
      hurt: this.flash > 0,
      status,
      alert,
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
      add('SLEW RATE', { size: title, weight: 800, spacing: '2px' }, title + 12)
      paragraph('Your car drives flat out: dodge the blocks and grab the white boost pads. Every few seconds the last two cars are cut. Be the last one standing.',
        { size: 16, weight: 500, color: colors.muted }, 34)
      paragraph('Steer with the mouse, a finger or the arrow keys. It speeds up race after race.',
        { size: 14, weight: 500, color: colors.muted }, 26)
    } else {
      add(`CUT AT P${this.final_rank} OF ${this.final_field}  ·  RACE ${this.race}`, { size: 12, weight: 700, color: colors.danger, spacing: '3px' }, 0)
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
    this.text(ctx, this.state === 'ready' ? 'Tap to start' : 'Tap to race again', center, y + 48, {
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
}

export default {
  id: 'slew-rate',
  name: 'Slew Rate',
  tagline: 'Dodge the blocks, don\'t get cut.',
  controls: 'Steer to race',
  color: '#8bd7cf',
  available: true,
  icon: '<svg class="no-background" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M20 6C16 18 6 30 4 42M28 6c4 12 14 24 16 36" opacity=".5"/><path d="M24 10v4M24 20v5M24 31v6" opacity=".5"/><rect x="14" y="30" width="8" height="7" rx="1"/><rect x="27" y="17" width="6" height="5" rx="1"/></svg>',
  create: stage => new SlewRate(stage),
}
