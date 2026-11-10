"use strict";

import { clamp, mix, hash, ambient, difficulty } from '../field.js'
import { text, wrap, hud } from '../ui.js'

// Interference: noise closes in on a chip at the center of the field. Each
// click emits a counter-wave; noise touched by the wave front is cancelled.
//
// - Quiet zone: waves fizzle inside the ring around the chip, and noise that
//   gets inside it can no longer be stopped, so it has to be intercepted early.
// - Data packets (white) must reach the chip: delivering one refunds a charge,
//   cancelling one costs points, the wave's combo and some charge.
// - Difficulty follows time survived on an ease-in-out curve that levels
//   off after a few minutes; from there on it is a test of focus.

const TAU = Math.PI * 2
const rand = (min, max) => min + Math.random() * (max - min)

const max_charge = 3
// Seconds per charge, from the start to the difficulty plateau: recharge
// speeds up with the noise, so fast hands keep up.
const recharge_easy = 0.9
const recharge_hard = 0.4
const max_integrity = 5
const tier_seconds = 15
// Seconds until the difficulty curve reaches its plateau.
const ramp_seconds = 150
const wave_speed = 420
const wave_reach = 200
// Bumped when the rules change, so old scores don't outlive a rebalance.
const best_key = 'best.v3'

const kinds = {
  hum:    { speed: 1,   radius: 24, hp: 1, value: 10 },
  spike:  { speed: 1.6, radius: 16, hp: 1, value: 15 },
  burst:  { speed: 0.7, radius: 36, hp: 2, value: 30 },
  signal: { speed: 1.1, radius: 13, hp: 1, value: 25 },
}

const colors = {
  wave: '139, 215, 207',
  noise: '255, 122, 89',
  text: '#e9eef5',
  muted: 'rgba(233, 238, 245, .62)',
  accent: '#62c5dd',
  wave_color: '#8bd7cf',
  gold: '#ffc36b',
  danger: '#ff6b6b',
}

class Interference {
  constructor (stage) {
    this.stage = stage
    this.store = stage.storage('interference')
    this.best = Number(this.store.get(best_key, 0)) || 0
    this.time = 0
    this.state = 'ready'
    this.state_time = 0
    this.reset()
  }

  get scale () {
    return clamp(Math.min(this.stage.width, this.stage.height) / 820, 0.65, 1.35)
  }
  get cx () { return this.stage.width / 2 }
  get cy () { return this.stage.height / 2 }
  get chip_size () { return 78 * this.scale }
  // Movement scales further down than the visuals, so small screens keep the
  // same reaction time instead of the same pixels per second.
  get pace_scale () {
    return clamp(Math.min(this.stage.width, this.stage.height) / 820, 0.45, 1.35)
  }
  // Capped by the short side, so on phones the ring doesn't eat the field.
  get quiet_radius () {
    return Math.min(this.chip_size * 2.1, Math.min(this.stage.width, this.stage.height) * 0.2)
  }
  get tier () { return 1 + Math.floor(this.elapsed / tier_seconds) }
  get ramp () { return difficulty(this.elapsed, ramp_seconds) }

  reset () {
    this.score = 0
    this.elapsed = 0
    this.level = 1
    this.integrity = max_integrity
    this.charge = max_charge
    this.noises = []
    this.waves = []
    this.pulses = []
    this.spawn_timer = 0.5
    this.shake = 0
    this.flash = 0
    this.best_beaten = false
  }

  start () {
    this.reset()
    this.state = 'playing'
    this.state_time = 0
  }

  pointer (type, x, y) {
    if (type !== 'down') return
    if (this.state === 'playing') {
      this.emit(x, y)
      return
    }
    // Ignore clicks right after losing, so a frantic last click doesn't skip
    // the score screen.
    if (this.state === 'over' && this.state_time < 0.9) return
    this.start()
  }

  emit (x, y) {
    const inside = Math.hypot(x - this.cx, y - this.cy) < this.quiet_radius
    const charged = this.charge >= 1
    if (charged) this.charge -= 1

    // Firing inside the quiet zone still spends the charge: no free shield.
    const dud = inside || !charged

    this.waves.push({
      x,
      y,
      age: 0,
      radius: 0,
      speed: wave_speed * this.scale * (dud ? 0.6 : 1),
      reach: (dud ? 60 : wave_reach) * this.scale,
      hit: new Set(),
      combo: 0,
      dud,
    })
  }

  pick_kind () {
    const t = this.elapsed
    if (t > 4 && Math.random() < 0.24) return 'signal'

    const ramp = this.ramp
    const burst = t > 25 ? mix(0.08, 0.3, ramp) : 0
    const spike = t > 10 ? mix(0.3, 0.5, ramp) : 0
    const roll = Math.random()
    if (roll < burst) return 'burst'
    if (roll < burst + spike) return 'spike'
    return 'hum'
  }

  spawn () {
    const { width, height } = this.stage
    const angle = Math.random() * TAU
    const ux = Math.cos(angle)
    const uy = Math.sin(angle)
    // Start just past the screen edge along the spawn direction.
    const edge = Math.min(
      Math.abs(ux) > 1e-3 ? width / 2 / Math.abs(ux) : Infinity,
      Math.abs(uy) > 1e-3 ? height / 2 / Math.abs(uy) : Infinity,
    )
    const kind = this.pick_kind()
    const spec = kinds[kind]
    const radius = spec.radius * this.scale
    const pace = mix(75, 220, this.ramp)

    this.noises.push({
      kind,
      ux,
      uy,
      dist: edge + radius * 2,
      speed: pace * spec.speed * this.pace_scale,
      radius,
      hp: spec.hp,
      value: spec.value,
      phase: rand(0, TAU),
      wobble: (kind === 'signal' ? rand(4, 10) : rand(8, 26)) * this.scale,
      freq: rand(1.1, 2.4),
      seed: rand(0, 1000),
      flash: 0,
      x: 0,
      y: 0,
      dead: false,
    })
  }

  damage (noise) {
    if (this.state !== 'playing') return
    this.integrity -= 1
    this.flash = 1
    this.shake = this.stage.reduced_motion() ? 0 : 0.5
    this.pulses.push({ x: noise.x, y: noise.y, age: 0, life: 0.9, cool: false })
    if (this.integrity <= 0) this.game_over()
  }

  deliver (noise) {
    if (this.state !== 'playing') return
    const points = noise.value * this.tier
    this.score += points
    this.charge = Math.min(max_charge, this.charge + 1)
    this.pulses.push({ x: noise.x, y: noise.y, age: 0, life: 0.6, cool: true })
  }

  game_over () {
    this.state = 'over'
    this.state_time = 0
    this.pulses.push({ x: this.cx, y: this.cy, age: 0, life: 1.6, cool: false })
    if (this.score > this.best) {
      this.best = this.score
      this.best_beaten = true
      this.store.set(best_key, this.best)
    }
  }

  // A small ring popping out of the field where something was cancelled.
  burst (noise, color = colors.wave) {
    this.pulses.push({ x: noise.x, y: noise.y, age: 0, life: 0.4, speed: 260, cool: color === colors.wave })
  }

  update (dt) {
    this.time += dt
    this.state_time += dt

    const playing = this.state === 'playing'
    const scale = this.scale
    const cx = this.cx
    const cy = this.cy
    const quiet = this.quiet_radius

    this.shake = Math.max(0, this.shake - dt * 2.4)
    this.flash = Math.max(0, this.flash - dt * 3)

    if (playing) {
      this.elapsed += dt
      this.charge = Math.min(max_charge, this.charge + dt / mix(recharge_easy, recharge_hard, this.ramp))

      this.level = this.tier

      // Spawns get denser along the curve, and later on often come in pairs.
      this.spawn_timer -= dt
      if (this.spawn_timer <= 0) {
        const ramp = this.ramp
        this.spawn()
        if (Math.random() < mix(0, 0.45, ramp)) this.spawn()
        this.spawn_timer = mix(1.1, 0.42, ramp) * rand(0.7, 1.2)
      }
    }

    for (const wave of this.waves) {
      wave.age += dt
      wave.radius = wave.age * wave.speed
    }
    this.waves = this.waves.filter(wave => wave.radius < wave.reach)

    for (const pulse of this.pulses) pulse.age += dt
    this.pulses = this.pulses.filter(pulse => pulse.age < pulse.life)

    // Noise drifts in along its spawn direction, wobbling sideways less and
    // less as it closes in on the chip. After a loss it keeps creeping in.
    const pace = playing ? 1 : this.state === 'over' ? 0.3 : 0
    const chip_reach = this.chip_size * 0.55
    for (const noise of this.noises) {
      noise.flash = Math.max(0, noise.flash - dt * 4)
      noise.dist -= noise.speed * dt * pace

      const lateral = Math.sin(this.time * noise.freq + noise.phase) *
        noise.wobble * clamp((noise.dist - chip_reach) / 220)
      noise.x = cx + noise.ux * noise.dist - noise.uy * lateral
      noise.y = cy + noise.uy * noise.dist + noise.ux * lateral

      if (noise.dist <= chip_reach + noise.radius * 0.5) {
        noise.dead = true
        if (noise.kind === 'signal') this.deliver(noise)
        else this.damage(noise)
      }
    }

    if (this.state === 'playing') {
      const far = Math.max(quiet + 1, Math.min(this.stage.width, this.stage.height) / 2)

      for (const wave of this.waves) {
        if (wave.dud) continue

        for (const noise of this.noises) {
          if (noise.dead || wave.hit.has(noise)) continue

          // Inside the quiet zone nothing can be cancelled any more.
          const from_chip = Math.hypot(noise.x - cx, noise.y - cy)
          if (from_chip < quiet) continue

          const distance = Math.hypot(noise.x - wave.x, noise.y - wave.y)
          if (Math.abs(distance - wave.radius) > 18 * scale + noise.radius * 0.7) continue

          wave.hit.add(noise)
          noise.hp -= 1
          noise.flash = 1

          if (noise.kind === 'signal') {
            const penalty = 40 * this.tier
            noise.dead = true
            wave.combo = 0
            this.score = Math.max(0, this.score - penalty)
            this.charge = Math.max(0, this.charge - 0.5)
            this.burst(noise, colors.noise)
            continue
          }

          if (noise.hp > 0) {
            noise.dist += 46 * scale
            continue
          }

          noise.dead = true
          wave.combo += 1

          // Up to double points for catching noise near the screen edge.
          const reach_bonus = 1 + clamp((from_chip - quiet) / (far - quiet))
          const points = Math.round(noise.value * this.tier * wave.combo * reach_bonus)
          this.score += points
          this.burst(noise)
        }
      }
    }

    this.noises = this.noises.filter(noise => !noise.dead)

  }

  render (ctx) {
    const { width, height } = this.stage

    ctx.save()
    if (this.shake > 0) {
      ctx.translate((Math.random() - 0.5) * 14 * this.shake, (Math.random() - 0.5) * 14 * this.shake)
    }
    this.draw_field(ctx, width, height)
    ctx.restore()

    this.draw_hud(ctx)
    if (this.state !== 'playing') this.draw_screen(ctx, width, height)
  }

  // Everything is drawn by the pixel field: the chip is a solid cyan block
  // with a white die and pin cells, the quiet zone a dim disc with a dashed
  // ring, waves are cool ripples, noise runs hot and data packets are white
  // diamonds, so they never read as part of a wave.
  draw_field (ctx, width, height) {
    const time = this.time
    const cx = this.cx
    const cy = this.cy
    const cell = width < 640 ? 15 : 19
    const half = this.chip_size / 2
    const die = half * 0.45
    const quiet = this.quiet_radius
    const waves = this.waves
    const noises = this.noises
    const pulses = this.pulses
    const hurt = this.flash
    const flicker = Math.floor(time * 16)
    const dash = time * 0.5

    this.stage.field.draw(ctx, width, height, (x, y, column, row, out) => {
      const dx = x - cx
      const dy = y - cy
      const ax = Math.abs(dx)
      const ay = Math.abs(dy)

      if (ax < half && ay < half) {
        out.level = 0.82
        out.color = colors.accent
        if (ax < die && ay < die) out.light = 0.6 + 0.15 * Math.sin(time * 3)
        if (hurt > 0) out.heat = hurt * (0.6 + 0.5 * hash(column + flicker * 0.37, row))
        return
      }
      // Pins: every other cell just outside each side of the chip.
      const pin = (ax < half && ay < half + cell && column % 2 === 0) ||
        (ay < half && ax < half + cell && row % 2 === 0)

      const from_chip = Math.hypot(dx, dy)
      const inside = from_chip < quiet
      // Waves are damped inside the quiet zone.
      const damp = inside ? 0.2 : 1
      let level = ambient(x / width, y / height, time) * (inside ? 0.22 : 0.5)

      if (pin) {
        level = Math.max(level, 0.5)
        out.color = colors.accent
      }

      // The quiet zone edge: a slowly turning dashed ring of cells.
      if (Math.abs(from_chip - quiet) < cell * 0.5) {
        const angle = Math.atan2(dy, dx) / (Math.PI * 2) + 0.5
        if (Math.floor(angle * 36 + dash) % 2 === 0) {
          level = Math.max(level, 0.3)
          out.color = colors.wave_color
        }
      }

      for (let i = 0; i < waves.length; i++) {
        const wave = waves[i]
        const front = Math.hypot(x - wave.x, y - wave.y) - wave.radius
        if (front > 90 || front < -90) continue
        const strength = (1 - wave.radius / wave.reach) * (wave.dud ? 0.3 : 1) * damp
        level += Math.cos(front * 0.06) * Math.exp(-Math.abs(front) / 45) * strength * 0.7
      }

      let heat = 0
      let light = 0
      for (let i = 0; i < noises.length; i++) {
        const noise = noises[i]
        const nx = x - noise.x
        const ny = y - noise.y
        const reach = noise.radius * 3
        if (nx > reach || nx < -reach || ny > reach || ny < -reach) continue

        if (noise.kind === 'signal') {
          const size = Math.max(cell * 1.5, noise.radius * 1.9)
          const l1 = Math.abs(nx) + Math.abs(ny)
          if (l1 < size) light += Math.sqrt(1 - l1 / size) * (0.85 + 0.2 * Math.sin(time * 6 + noise.seed))
          continue
        }

        const sigma = noise.radius * 1.1
        const glow = Math.exp(-(nx * nx + ny * ny) / (2 * sigma * sigma))
        // Bursts (two hits) burn a hotter core until the first hit lands.
        heat += glow * (noise.hp > 1 ? 1.3 : 1)
        if (noise.flash > 0) light += glow * noise.flash
      }
      if (heat > 0.02) heat *= 0.6 + 0.55 * hash(column + flicker * 0.37, row)

      for (let i = 0; i < pulses.length; i++) {
        const pulse = pulses[i]
        const front = Math.hypot(x - pulse.x, y - pulse.y) - pulse.age * (pulse.speed ?? 520)
        const strength = Math.exp(-Math.abs(front) / 30) * (1 - pulse.age / pulse.life) * 0.8
        if (pulse.cool) level += strength
        else heat += strength
      }

      out.level = level
      out.heat = heat
      out.light = light
    })
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
      charge: this.charge,
      charge_max: max_charge,
    })
  }

  draw_screen (ctx, width, height) {
    // Short screens (phones in landscape) have no room above the ring, so the
    // copy is centered over a darker backdrop instead of framing the chip.
    const compact = this.cy - this.quiet_radius < 170
    ctx.fillStyle = `rgba(7, 11, 18, ${compact ? 0.82 : 0.55})`
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
      add('ADI ARCADE  ·  ELECTRONICA 2026', { size: 12, weight: 700, color: colors.accent, spacing: '3px' }, 0)
      add('INTERFERENCE', { size: title, weight: 800, spacing: '2px' }, title + 12)
      paragraph('Cancel the red noise with counter-waves. Let the white data reach the chip.',
        { size: 16, weight: 500, color: colors.muted }, 34)
      paragraph('Waves fizzle inside the ring, so intercept early. It gets faster every second.',
        { size: 14, weight: 500, color: colors.muted }, 26)
    } else {
      add(`SIGNAL LOST  ·  SURVIVED ${Math.floor(this.elapsed)}s`, { size: 12, weight: 700, color: colors.danger, spacing: '3px' }, 0)
      add(String(this.score), { size: title * 1.15, weight: 800 }, title * 1.15 + 12)
      add(this.best_beaten ? 'New best score!' : `Best ${this.best}`,
        { size: 16, weight: 700, color: this.best_beaten ? colors.gold : colors.muted }, 34)
    }

    const total = lines.reduce((sum, line) => sum + line.lead, 0)
    let y = compact
      ? Math.max(70, (height - total) / 2 - 20)
      : Math.max(110, this.cy - this.quiet_radius - total - 24)
    for (const line of lines) {
      y += line.lead
      this.text(ctx, line.text, center, y, { ...line.style, align: 'center' })
    }

    if (this.state === 'over' && this.state_time < 0.9) return

    ctx.globalAlpha = 0.55 + 0.45 * Math.sin(this.time * 4)
    this.text(ctx, this.state === 'ready' ? 'Tap to start' : 'Tap to play again',
      center, compact ? y + 44 : this.cy + this.chip_size / 2 + 70, {
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
  id: 'interference',
  name: 'Interference',
  tagline: 'Cancel the noise, let the data through.',
  controls: 'Tap to emit',
  color: '#92befc',
  available: true,
  icon: '<svg class="no-background" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="18" y="18" width="12" height="12" rx="2"/><circle cx="24" cy="24" r="13" opacity=".6"/><circle cx="24" cy="24" r="20" opacity=".3"/></svg>',
  create: stage => new Interference(stage),
}
