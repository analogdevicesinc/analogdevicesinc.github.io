"use strict";

import { clamp, mix, hash, ambient } from '../field.js'
import { text, wrap, hud_bottom } from '../ui.js'
import { Chip, note } from '../chip.js'

// Pong: two players on one screen, a paddle each, first to seven. The board
// follows the screen: wider than tall, the paddles sit left and right; taller
// than wide, top and bottom. Everything is drawn by the pixel field.
//
// - Each player drags on their own side; keys work too (W/S or A/D and the
//   arrows). A paddle nobody has touched for a few seconds is driven by the
//   computer, so the game also works alone.
// - The ball leaves the paddle at an angle set by where it hits, and speeds
//   up with every return until the point ends.
// - Power-ups appear mid-board; the last player to hit the ball collects
//   them: a bigger paddle, a smaller one for the other side, three balls, or
//   a faster ball.

const win_score = 7
const serve_delay = 1.1
const idle_takeover = 3
// Ball speed across the board, in board lengths per second, and how much
// each return adds.
const serve_speed = 0.55
const speed_step = 1.06
const max_speed = 1.6
// Paddle length, as a share of the board's width (the side it moves along).
const paddle_share = 0.18
const paddle_speed = 1.6
const power_every = [5, 9]
const power_life = 9
const effect_life = 8
// Bumped when the rules change, so old records don't outlive a rebalance.
const best_key = 'rally.v1'

const colors = {
  text: '#e9eef5',
  muted: 'rgba(233, 238, 245, .62)',
  accent: '#62c5dd',
  gold: '#ffc36b',
  danger: '#ff6b6b',
  players: ['#62c5dd', '#c1b4ef'],
}

// The power-ups: how they look on the board and what they do for the player
// who collects them.
const power_looks = {
  grow:   { color: '#8bd7cf' },
  shrink: { heat: 0.75 },
  multi:  { color: '#ffc36b' },
  fast:   { light: 0.9 },
}
const power_kinds = Object.keys(power_looks)

// A bouncy tune in E minor, trading phrases like a rally.
const tune = {
  bpm: 132,
  hats: 1,
  hat_volume: 0.06,
  volume: 0.12,
  lead:
    'E4:0.5 G4:0.5 B4 A4:0.5 G4:0.5 E4 ' +
    'D4:0.5 F#4:0.5 A4 G4:0.5 F#4:0.5 D4 ' +
    'C4:0.5 E4:0.5 G4 A4:0.5 G4:0.5 E4 ' +
    'B3:0.5 D4:0.5 F#4 G4 R ' +
    'E4:0.5 E4:0.5 R:0.5 G4:0.5 B4 R ' +
    'D4:0.5 D4:0.5 R:0.5 F#4:0.5 A4 R ' +
    'C4:0.5 E4:0.5 G4:0.5 C5:0.5 B4:0.5 A4:0.5 G4:0.5 F#4:0.5 ' +
    'E4:2 R:2',
  bass:
    'E2:0.5 E3:0.5 E2:0.5 E3:0.5 E2:0.5 E3:0.5 E2:0.5 E3:0.5 ' +
    'D2:0.5 D3:0.5 D2:0.5 D3:0.5 D2:0.5 D3:0.5 D2:0.5 D3:0.5 ' +
    'C2:0.5 C3:0.5 C2:0.5 C3:0.5 C2:0.5 C3:0.5 C2:0.5 C3:0.5 ' +
    'B1:0.5 B2:0.5 B1:0.5 B2:0.5 B1:0.5 B2:0.5 B1:0.5 B2:0.5 ' +
    'E2:0.5 E3:0.5 E2:0.5 E3:0.5 E2:0.5 E3:0.5 E2:0.5 E3:0.5 ' +
    'D2:0.5 D3:0.5 D2:0.5 D3:0.5 D2:0.5 D3:0.5 D2:0.5 D3:0.5 ' +
    'C2:0.5 C3:0.5 C2:0.5 C3:0.5 B1:0.5 B2:0.5 B1:0.5 B2:0.5 ' +
    'E2:0.5 E3:0.5 E2:0.5 E3:0.5 E2 R',
}

// Keys per player: the first pair moves along a vertical side (landscape),
// the second along a horizontal one (portrait). Both pairs always work.
const keys = [
  { w: -1, s: 1, a: -1, d: 1 },
  { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -1, ArrowRight: 1 },
]

class Pong {
  constructor (stage) {
    this.stage = stage
    this.store = stage.storage('pong')
    this.best = Number(this.store.get(best_key, 0)) || 0
    this.time = 0
    this.state = 'ready'
    this.state_time = 0
    this.chip = null
    this.music = null
    this.reset()
  }

  // -- Board ----------------------------------------------------------------

  // The board fills the screen below the HUD. `across` runs from player 1's
  // goal to player 2's, `along` is the side the paddles move on.
  get layout () {
    const { width, height } = this.stage
    const margin = width < 640 ? 10 : 18
    const x = margin
    const y = hud_bottom
    const w = width - margin * 2
    const h = height - hud_bottom - margin
    const landscape = w >= h
    return { x, y, w, h, landscape, across: landscape ? w : h, along: landscape ? h : w }
  }

  // Board coordinates (across 0..1, along 0..1) to the screen.
  to_screen (a, l, layout = this.layout) {
    return layout.landscape
      ? [layout.x + a * layout.w, layout.y + l * layout.h]
      : [layout.x + l * layout.w, layout.y + a * layout.h]
  }

  to_board (px, py, layout = this.layout) {
    const u = (px - layout.x) / layout.w
    const v = (py - layout.y) / layout.h
    return layout.landscape ? [u, v] : [v, u]
  }

  reset () {
    this.scores = [0, 0]
    this.paddles = [0, 1].map(index => ({
      index,
      pos: 0.5,
      size: 1,
      effect: 0,
      // Last input from a person, so the computer knows when to step in.
      touched: -Infinity,
      pointer: null,
      keys: 0,
      hit: 0,
    }))
    this.balls = []
    this.powers = []
    this.ripples = []
    this.serve_timer = serve_delay
    this.serve_to = Math.random() < 0.5 ? 0 : 1
    this.next_power = mix(power_every[0], power_every[1], Math.random())
    this.fast = 0
    this.rally = 0
    this.longest = 0
    this.last_hitter = null
    this.goal_flash = [0, 0]
    this.winner = null
    this.best_beaten = false
    this.elapsed = 0
  }

  // Called from a tap or key press, so audio may start.
  start () {
    this.chip ??= new Chip()
    this.chip.resume()
    this.reset()
    this.state = 'playing'
    this.state_time = 0
    this.music?.stop()
    this.music = this.chip.tune(tune)
  }

  // -- Input ----------------------------------------------------------------

  // A pointer drives the paddle on the side it came down on, and follows the
  // finger while it is down. A mouse drives its side by hovering.
  pointer (type, x, y, event) {
    if (type === 'down' && this.state !== 'playing') {
      if (this.state === 'over' && this.state_time < 0.9) return
      this.start()
      return
    }
    if (this.state !== 'playing') return
    const [a, l] = this.to_board(x, y)
    const mouse = event.pointerType === 'mouse'
    if (type === 'down' || (mouse && type === 'move')) {
      const paddle = this.paddles[a < 0.5 ? 0 : 1]
      if (mouse) {
        // One mouse, one paddle: the side it is over.
        for (const other of this.paddles) if (other.pointer === 'mouse') other.pointer = null
        if (paddle.pointer === null) paddle.pointer = 'mouse'
      } else if (type === 'down') {
        paddle.pointer = event.pointerId
      }
    }
    for (const paddle of this.paddles) {
      if (paddle.pointer !== (mouse ? 'mouse' : event.pointerId)) continue
      if (type === 'up' || type === 'cancel') {
        if (!mouse) paddle.pointer = null
        continue
      }
      paddle.target = clamp(l)
      paddle.touched = this.time
    }
  }

  key (type, event) {
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
    const index = keys.findIndex(map => key in map)
    if (index < 0) {
      if (key !== ' ' && key !== 'Enter') return false
      if (type === 'down' && !event.repeat && this.state !== 'playing') {
        if (this.state === 'over' && this.state_time < 0.9) return true
        this.start()
      }
      return true
    }
    const paddle = this.paddles[index]
    const dir = keys[index][key]
    if (type === 'down') {
      if (this.state !== 'playing' && !event.repeat) {
        if (!(this.state === 'over' && this.state_time < 0.9)) this.start()
      }
      paddle.keys = dir
      paddle.target = null
      paddle.touched = this.time
    } else if (paddle.keys === dir) {
      paddle.keys = 0
    }
    return true
  }

  // -- Simulation -----------------------------------------------------------

  update (dt) {
    this.time += dt
    this.state_time += dt
    this.music?.update()
    for (const ripple of this.ripples) ripple.age += dt
    this.ripples = this.ripples.filter(ripple => ripple.age < ripple.life)
    for (let i = 0; i < 2; i++) this.goal_flash[i] = Math.max(0, this.goal_flash[i] - dt * 1.6)
    for (const paddle of this.paddles) paddle.hit = Math.max(0, paddle.hit - dt * 4)

    if (this.state === 'ready') {
      // Attract mode: the computer plays itself.
      this.move_paddles(dt, true)
      this.move_balls(dt)
      if (!this.balls.length) {
        this.serve_timer -= dt
        if (this.serve_timer <= 0) this.serve()
      }
      return
    }
    if (this.state !== 'playing') return

    this.elapsed += dt
    this.fast = Math.max(0, this.fast - dt)
    for (const paddle of this.paddles) {
      paddle.effect = Math.max(0, paddle.effect - dt)
      if (paddle.effect === 0) paddle.size += (1 - paddle.size) * Math.min(1, dt * 6)
    }

    this.move_paddles(dt, false)

    if (!this.balls.length) {
      this.serve_timer -= dt
      if (this.serve_timer <= 0) this.serve()
    }
    this.move_balls(dt)

    for (const power of this.powers) power.age += dt
    this.powers = this.powers.filter(power => power.age < power_life)
    this.next_power -= dt
    if (this.next_power <= 0 && this.powers.length < 2) {
      this.powers.push({
        kind: power_kinds[Math.floor(Math.random() * power_kinds.length)],
        a: mix(0.3, 0.7, Math.random()),
        l: mix(0.15, 0.85, Math.random()),
        age: 0,
      })
      this.next_power = mix(power_every[0], power_every[1], Math.random())
    }
  }

  // Paddles follow the finger, the keys, or the computer: the nearest ball
  // heading their way, a little late and a little off.
  move_paddles (dt, attract) {
    const layout = this.layout
    const limit = speed => speed * dt
    for (const paddle of this.paddles) {
      const half = this.paddle_half(paddle, layout)
      const idle = attract || this.time - paddle.touched > idle_takeover
      let target = paddle.pos
      if (!idle && paddle.keys) {
        target = paddle.pos + paddle.keys * paddle_speed * dt
      } else if (!idle && paddle.target !== null && paddle.target !== undefined) {
        target = paddle.target
      } else {
        const ball = this.incoming(paddle.index)
        target = ball ? ball.l + Math.sin(this.time * 1.7 + paddle.index * 3) * half * 0.5 : 0.5
        paddle.pos += clamp(target - paddle.pos, -limit(attract ? 0.9 : 1.1), limit(attract ? 0.9 : 1.1))
        paddle.pos = clamp(paddle.pos, half, 1 - half)
        continue
      }
      paddle.pos += clamp(target - paddle.pos, -limit(paddle_speed * 2.5), limit(paddle_speed * 2.5))
      paddle.pos = clamp(paddle.pos, half, 1 - half)
    }
  }

  // Half a paddle's length, in `along` units.
  paddle_half (paddle, layout = this.layout) {
    return paddle_share * paddle.size / 2
  }

  // Paddle thickness and ball radius in `across` units, from a cell size.
  cell_across (layout = this.layout) {
    const cell = this.stage.width < 640 ? 15 : 19
    return cell / layout.across
  }

  // The ball coming toward a player, the nearest first.
  incoming (index) {
    const dir = index === 0 ? -1 : 1
    let best = null
    for (const ball of this.balls) {
      if (Math.sign(ball.va) !== dir) continue
      const dist = index === 0 ? ball.a : 1 - ball.a
      if (!best || dist < best.dist) best = { ball, dist }
    }
    return best?.ball ?? null
  }

  serve () {
    const dir = this.serve_to === 0 ? -1 : 1
    const angle = mix(-0.6, 0.6, Math.random())
    this.balls.push(this.ball(0.5, 0.5, dir, angle, serve_speed))
    this.rally = 0
    this.last_hitter = null
  }

  ball (a, l, dir, angle, speed) {
    return { a, l, va: Math.cos(angle) * speed * dir, vl: Math.sin(angle) * speed, speed, trail: [] }
  }

  move_balls (dt) {
    const layout = this.layout
    const ratio = layout.across / layout.along
    const thick = this.cell_across(layout)
    const radius = thick * 0.9
    for (const ball of this.balls) {
      const speed = ball.speed * (this.fast > 0 ? 1.6 : 1)
      const scale = speed / Math.hypot(ball.va, ball.vl)
      ball.trail.push({ a: ball.a, l: ball.l })
      if (ball.trail.length > 10) ball.trail.shift()
      ball.a += ball.va * scale * dt
      // `along` velocity is in across units; the board is `ratio` times
      // wider across than along.
      ball.l += ball.vl * scale * dt * ratio

      // Walls along the sides.
      const edge = radius * ratio
      if (ball.l < edge && ball.vl < 0) {
        ball.l = edge
        ball.vl = -ball.vl
        this.tick(ball)
      } else if (ball.l > 1 - edge && ball.vl > 0) {
        ball.l = 1 - edge
        ball.vl = -ball.vl
        this.tick(ball)
      }

      // Paddles.
      for (const paddle of this.paddles) {
        const face = paddle.index === 0 ? thick * 2 : 1 - thick * 2
        const toward = paddle.index === 0 ? ball.va < 0 : ball.va > 0
        if (!toward) continue
        const past = paddle.index === 0 ? ball.a - radius < face : ball.a + radius > face
        const far = paddle.index === 0 ? ball.a + radius < face - thick : ball.a - radius > face + thick
        if (!past || far) continue
        const half = this.paddle_half(paddle, layout) + radius * ratio * 0.5
        const off = (ball.l - paddle.pos) / half
        if (Math.abs(off) > 1) continue
        this.return_ball(ball, paddle, off, face, radius)
      }

      // Power-ups: the last player to hit the ball collects them.
      if (this.state === 'playing' && this.last_hitter !== null) {
        for (const power of this.powers) {
          if (power.taken) continue
          const da = (power.a - ball.a) / thick
          const dl = (power.l - ball.l) / (thick * ratio)
          if (Math.abs(da) < 2.2 && Math.abs(dl) < 2.2) this.collect(power, ball)
        }
        this.powers = this.powers.filter(power => !power.taken)
      }
    }

    // Past a goal line: a point for the other side.
    const out = this.balls.filter(ball => ball.a < -radius * 2 || ball.a > 1 + radius * 2)
    for (const ball of out) {
      const scorer = ball.a < 0 ? 1 : 0
      this.balls.splice(this.balls.indexOf(ball), 1)
      if (this.state === 'playing') this.point(scorer, ball)
      else this.goal_flash[1 - scorer] = 0.6
    }
    if (!this.balls.length && this.serve_timer <= 0) this.serve_timer = serve_delay
  }

  return_ball (ball, paddle, off, face, radius) {
    const dir = paddle.index === 0 ? 1 : -1
    const angle = off * 1.05
    ball.speed = Math.min(max_speed, ball.speed * speed_step)
    ball.va = Math.cos(angle) * ball.speed * dir
    ball.vl = Math.sin(angle) * ball.speed
    ball.a = face + dir * radius * 1.01
    paddle.hit = 1
    this.last_hitter = paddle.index
    if (this.state === 'playing') {
      this.rally += 1
      this.longest = Math.max(this.longest, this.rally)
    }
    this.ripples.push({ a: ball.a, l: ball.l, age: 0, life: 0.5, speed: 1.4, color: colors.players[paddle.index] })
    this.chip?.play(mix(330, 660, (ball.speed - serve_speed) / (max_speed - serve_speed)), 0.06, { wave: 'square', volume: 0.22 })
  }

  tick (ball) {
    this.ripples.push({ a: ball.a, l: ball.l, age: 0, life: 0.35, speed: 1, light: true })
    this.chip?.play(220, 0.04, { wave: 'square', volume: 0.16 })
  }

  collect (power, ball) {
    power.taken = true
    const owner = this.paddles[this.last_hitter]
    const other = this.paddles[1 - this.last_hitter]
    switch (power.kind) {
      case 'grow':
        owner.size = 1.7
        owner.effect = effect_life
        break
      case 'shrink':
        other.size = 0.55
        other.effect = effect_life
        break
      case 'multi': {
        const dir = Math.sign(ball.va)
        const angle = Math.atan2(ball.vl, Math.abs(ball.va))
        for (const spread of [-0.5, 0.5]) {
          this.balls.push(this.ball(ball.a, ball.l, dir, angle + spread, ball.speed))
        }
        break
      }
      case 'fast':
        this.fast = effect_life
        break
    }
    this.ripples.push({ a: power.a, l: power.l, age: 0, life: 0.8, speed: 2.2, color: colors.players[owner.index] })
    this.chip?.melody([note('C5'), note('E5'), note('G5'), note('C6')], 0.06, { volume: 0.2 })
  }

  point (scorer, ball) {
    this.scores[scorer] += 1
    this.goal_flash[1 - scorer] = 1
    this.serve_to = 1 - scorer
    this.ripples.push({ a: ball.a < 0 ? 0 : 1, l: ball.l, age: 0, life: 0.9, speed: 2.4, hot: true })
    if (this.scores[scorer] >= win_score) {
      this.game_over(scorer)
      return
    }
    this.chip?.melody([note('A4'), note('E4')], 0.1, { volume: 0.22 })
    this.chip?.noise(0.3, { volume: 0.3, filter: 'lowpass', freq: 1800, to: 200 })
    if (this.balls.length === 0) this.serve_timer = serve_delay
  }

  game_over (winner) {
    this.state = 'over'
    this.state_time = 0
    this.winner = winner
    this.balls = []
    this.powers = []
    this.music?.stop()
    this.music = null
    if (this.longest > this.best) {
      this.best = this.longest
      this.best_beaten = true
      this.store.set(best_key, this.best)
    }
    this.chip?.melody(['C5', 'E5', 'G5', 'C6', 'G5'].map(note), 0.1, { delay: 0.3, volume: 0.22 })
    this.chip?.play(note('C6'), 0.5, { delay: 0.8, volume: 0.22 })
    this.chip?.melody(['C3', 'G3', 'C4'].map(note), 0.2, { delay: 0.3, bass: true, length: 0.18 })
  }

  // -- Rendering ------------------------------------------------------------

  render (ctx) {
    const { width, height } = this.stage
    this.draw_field(ctx, width, height)
    this.draw_hud(ctx, width)
    if (this.state !== 'playing') this.draw_screen(ctx, width, height)
  }

  // The field draws it all: paddles in each player's color, a white ball
  // with a fading trail, a dashed centre line, pulsing power-ups and a hot
  // flash along a goal line that was just beaten.
  draw_field (ctx, width, height) {
    const time = this.time
    const layout = this.layout
    const thick = this.cell_across(layout)
    const ratio = layout.across / layout.along
    const paddles = this.paddles
    const balls = this.balls
    const powers = this.powers
    const ripples = this.ripples
    const flash = this.goal_flash
    const flicker = Math.floor(time * 14)
    const fast = this.fast > 0
    const winner = this.winner
    const over = this.state === 'over'
    const halves = paddles.map(paddle => this.paddle_half(paddle, layout))

    this.stage.field.draw(ctx, width, height, (x, y, column, row, out) => {
      const [a, l] = this.to_board(x, y, layout)
      const on_board = a >= -thick / 2 && a <= 1 + thick / 2 && l >= -thick * ratio / 2 && l <= 1 + thick * ratio / 2
      let level = ambient(x / width, y / height, time) * (on_board ? 0.3 : 0.14)

      if (!on_board) {
        out.level = level
        return
      }

      // Paddles.
      for (const paddle of paddles) {
        const face = paddle.index === 0 ? thick * 1.5 : 1 - thick * 1.5
        if (Math.abs(a - face) > thick * 0.75) continue
        if (Math.abs(l - paddle.pos) > halves[paddle.index]) continue
        out.level = 0.95
        out.color = colors.players[paddle.index]
        if (paddle.hit > 0) out.light = paddle.hit * 0.9
        // A power-up in effect shimmers.
        if (paddle.effect > 0 && hash(column + flicker * 0.31, row) > 0.7) out.light = 0.6
        return
      }

      // Balls, with a trail.
      for (const ball of balls) {
        const da = (ball.a - a) / thick
        const dl = (ball.l - l) / (thick * ratio)
        if (Math.abs(da) < 1 && Math.abs(dl) < 1) {
          out.light = 1
          if (fast) out.heat = 0.6
          return
        }
        for (let i = 0; i < ball.trail.length; i++) {
          const point = ball.trail[i]
          const ta = (point.a - a) / thick
          const tl = (point.l - l) / (thick * ratio)
          if (Math.abs(ta) < 0.6 && Math.abs(tl) < 0.6) {
            const fade = (i + 1) / ball.trail.length
            if (fast) out.heat = Math.max(out.heat, fade * 0.7)
            else out.light = Math.max(out.light, fade * 0.45)
          }
        }
      }
      if (out.light > 0 || out.heat > 0) return

      // Power-ups: a 3x3 block, pulsing, flickering out at the end.
      for (const power of powers) {
        const da = Math.abs(power.a - a) / thick
        const dl = Math.abs(power.l - l) / (thick * ratio)
        if (da > 1.5 || dl > 1.5) continue
        const left = power_life - power.age
        if (left < 2 && hash(flicker, column) > left / 2) continue
        const pulse = 0.75 + 0.25 * Math.sin(time * 6 + power.a * 20)
        const look = power_looks[power.kind]
        if (look.color) {
          out.level = pulse
          out.color = look.color
        } else if (look.heat) {
          out.heat = look.heat * pulse
        } else {
          out.light = look.light * pulse
        }
        return
      }

      // Centre line, dashed.
      if (Math.abs(a - 0.5) < thick / 2 && (layout.landscape ? row : column) % 2 === 0) {
        level = Math.max(level, 0.3)
      }

      // Ripples from hits and pickups.
      let light = 0
      let heat = 0
      let color = null
      // Distances in `along` units, so rings are round on screen.
      for (const ripple of ripples) {
        const r = ripple.age * ripple.speed * 0.25
        const d = Math.hypot((a - ripple.a) * ratio, l - ripple.l)
        const band = Math.exp(-Math.pow((d - r) / 0.03, 2))
        const strength = band * (1 - ripple.age / ripple.life)
        if (ripple.hot) heat = Math.max(heat, strength)
        else if (ripple.light) light = Math.max(light, strength * 0.7)
        else if (strength > 0.1) {
          level = Math.max(level, strength)
          color = ripple.color
        }
      }

      // A beaten goal line flashes hot.
      const near_goal = Math.min(a, 1 - a)
      const side = a < 0.5 ? 0 : 1
      if (flash[side] > 0 && near_goal < 0.08) {
        heat = Math.max(heat, flash[side] * (1 - near_goal / 0.08) * (0.5 + 0.5 * hash(column + flicker * 0.41, row)))
      }

      // The winner's side glows in their colour.
      if (over && winner !== null && (a < 0.5) === (winner === 0)) {
        level = Math.max(level, 0.45 + 0.1 * Math.sin(time * 3))
        color = colors.players[winner]
      }

      out.level = level
      out.light = light
      out.heat = heat
      out.color = color
    })
  }

  // The scores in the players' colours, and one muted line below.
  draw_hud (ctx, width) {
    const x = 24
    const middle = 34
    const font = this.stage.font
    const [p1, p2] = this.scores
    text(ctx, font, String(p1), x, middle + 10, { size: 28, weight: 800, color: colors.players[0] })
    let left = x + ctx.measureText(String(p1)).width + 8
    text(ctx, font, '·', left, middle + 10, { size: 28, weight: 800, color: colors.muted })
    left += ctx.measureText('·').width + 8
    text(ctx, font, String(p2), left, middle + 10, { size: 28, weight: 800, color: colors.players[1] })

    const parts = [`FIRST TO ${win_score}`]
    if (this.state === 'playing') parts.push(`RALLY ${this.rally}`)
    parts.push(`BEST RALLY ${Math.max(this.best, this.longest)}`)
    text(ctx, font, parts.join('  ·  '), x, middle + 30, { size: 11, weight: 600, color: colors.muted, spacing: '1px' })
  }

  draw_screen (ctx, width, height) {
    ctx.fillStyle = 'rgba(7, 11, 18, .7)'
    ctx.fillRect(0, 0, width, height)

    const center = width / 2
    const max_width = Math.min(width - 48, 640)
    const title = clamp(width * 0.06, 26, 56)
    const lines = []
    const add = (text, style, lead) => lines.push({ text, style, lead })
    const paragraph = (text, style, lead) => {
      this.wrap(ctx, text, max_width, style).forEach((line, i) => add(line, style, i ? style.size * 1.4 : lead))
    }

    if (this.state === 'ready') {
      const sides = this.layout.landscape ? 'left and right' : 'top and bottom'
      add('ADI ARCADE', { size: 12, weight: 700, color: colors.accent, spacing: '3px' }, 0)
      add('PONG', { size: title, weight: 800, spacing: '2px' }, title + 12)
      paragraph(`Two players, ${sides}. Drag on your side to move your paddle, or use W/S and the arrows. First to ${win_score}.`,
        { size: 16, weight: 500, color: colors.muted }, 34)
      paragraph('Hit the power-ups with the ball: grow, shrink the other paddle, split the ball, or speed it up. Alone, the computer takes the other side.',
        { size: 14, weight: 500, color: colors.muted }, 26)
    } else {
      const [p1, p2] = this.scores
      add(`PLAYER ${this.winner + 1} WINS`, { size: 12, weight: 700, color: colors.players[this.winner], spacing: '3px' }, 0)
      add(`${p1} · ${p2}`, { size: title * 1.15, weight: 800 }, title * 1.15 + 12)
      add(this.best_beaten ? `Longest rally ${this.longest}, a new best!` : `Longest rally ${this.longest}  ·  Best ${this.best}`,
        { size: 16, weight: 700, color: this.best_beaten ? colors.gold : colors.muted }, 34)
    }

    const total = lines.reduce((sum, line) => sum + line.lead, 0)
    let y = Math.max(110, (height - total) / 2 - 30)
    for (const line of lines) {
      y += line.lead
      this.text(ctx, line.text, center, y, { ...line.style, align: 'center' })
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

  destroy () {
    this.music?.stop()
    this.music = null
    this.chip?.close()
    this.chip = null
  }
}

export default {
  id: 'pong',
  name: 'Pong',
  tagline: 'Two players, one ball, power-ups.',
  controls: 'Drag your side',
  color: '#64a9ee',
  available: true,
  icon: '<svg class="no-background" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M24 6v4M24 16v4M24 28v4M24 38v4" opacity=".5"/><rect x="6" y="14" width="4" height="14" rx="1"/><rect x="38" y="22" width="4" height="14" rx="1"/><rect x="27" y="19" width="5" height="5" rx="1"/></svg>',
  create: stage => new Pong(stage),
}
